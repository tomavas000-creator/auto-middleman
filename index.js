const {
  Client, GatewayIntentBits, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType, PermissionsBitField, EmbedBuilder,
  SlashCommandBuilder, REST, Routes, AuditLogEvent
} = require('discord.js');
const axios = require('axios');
const fs = require('fs');

// ========== CONFIGURATION WITH YOUR IDs ==========
const CONFIG = {
  OWNER_ID: '1282001169274638376',
  ALT_ACCOUNT_ID: '1441923105252577352',
  TICKET_CHANNEL_ID: '1491418729026686986',
  MIDDLEMAN_ROLE_ID: '1491383323065454614',
  LOGS_CHANNEL_ID: '1491418866969215016',
  ANNOUNCEMENTS_CHANNEL_ID: '1491418607312437441',
  TICKET_CATEGORY_ID: '1491432981456486451',
  LTC_WALLET_ADDRESS: 'Lc3KMNeEH1RXeo77kBHTMexQSQ7CoVWk6V'
};

const FEES = { over250: 1.50, under250: 0.50, free: 0.00, freeThreshold: 50, over250Threshold: 250 };

// ========== STORAGE ==========
const DATA_FILE = 'gamerprotect_data.json';
let userData = new Map();
let trades = new Map();
let stepStates = new Map();
let roleConfirmations = new Map();
let amountConfirmations = new Map();
let feeConfirmations = new Map();
let liveRates = { ltc: 55.83, usdt: 1.00 };

// ========== HELPER FUNCTIONS ==========
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      if (data.userData) {
        for (const [k, v] of Object.entries(data.userData)) userData.set(k, v);
      }
      console.log(`✅ Loaded ${userData.size} users`);
    }
  } catch (e) { console.log('Error loading data:', e); }
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ userData: Object.fromEntries(userData) }, null, 2));
  } catch (e) { console.log('Error saving data:', e); }
}

function getUser(id) {
  let d = userData.get(id);
  if (!d) {
    d = { balance: 0, rep: 0, streak: 0, lastDaily: 0, referrals: [], achievements: [], totalTrades: 0 };
    userData.set(id, d);
  }
  return d;
}

function saveUser(id, d) {
  userData.set(id, d);
  saveData();
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ========== SECURITY ALERTS - ONLY TO OWNER AND ALT ACCOUNT ==========
async function sendSecurityAlert(title, desc, color = 0xff0000) {
  try {
    const owner = await client.users.fetch(CONFIG.OWNER_ID);
    const embed = new EmbedBuilder().setTitle(`🛡️ ${title}`).setDescription(desc).setColor(color).setTimestamp();
    await owner.send({ embeds: [embed] }).catch(() => {});
    
    // ONLY send to alt account, NOT to middlemen
    if (CONFIG.ALT_ACCOUNT_ID) {
      const alt = await client.users.fetch(CONFIG.ALT_ACCOUNT_ID);
      await alt.send({ embeds: [embed] }).catch(() => {});
    }
  } catch (e) {}
}

// ========== SIMILAR USER CHECK ==========
function calcSimilarity(a, b) {
  const s1 = a.toLowerCase(), s2 = b.toLowerCase();
  if (s1 === s2) return 100;
  if (s1.includes(s2) || s2.includes(s1)) return 75;
  let m = 0;
  for (let i = 0; i < Math.min(s1.length, s2.length); i++) if (s1[i] === s2[i]) m++;
  return (m / Math.max(s1.length, s2.length)) * 100;
}

async function findSimilarUsers(guild, target) {
  const similar = [];
  await guild.members.fetch();
  for (const m of guild.members.cache.values()) {
    if (m.id === target.id) continue;
    const sim = calcSimilarity(target.username, m.user.username);
    if (sim >= 50) {
      similar.push({
        id: m.id,
        username: m.user.username,
        similarity: Math.round(sim),
        joinDate: m.joinedAt || new Date()
      });
    }
  }
  return similar.sort((a, b) => b.similarity - a.similarity).slice(0, 10);
}

// ========== AUDIT LOG MONITORING (ONLY TO OWNER AND ALT) ==========
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildWebhooks
  ]
});

client.on('roleDelete', async (role) => {
  try {
    const log = await role.guild.fetchAuditLogs({ type: AuditLogEvent.RoleDelete, limit: 1 });
    const exe = log.entries.first()?.executor;
    if (exe && exe.id !== CONFIG.OWNER_ID) {
      await sendSecurityAlert('⚠️ ROLE DELETED', `**Role:** ${role.name}\n**Executor:** ${exe.tag}\n**Server:** ${role.guild.name}`, 0xff0000);
    }
  } catch (e) {}
});

client.on('roleCreate', async (role) => {
  try {
    const log = await role.guild.fetchAuditLogs({ type: AuditLogEvent.RoleCreate, limit: 1 });
    const exe = log.entries.first()?.executor;
    if (exe && exe.id !== CONFIG.OWNER_ID) {
      await sendSecurityAlert('⚠️ ROLE CREATED', `**Role:** ${role.name}\n**Executor:** ${exe.tag}\n**Server:** ${role.guild.name}`, 0xffaa00);
    }
  } catch (e) {}
});

client.on('channelDelete', async (ch) => {
  try {
    const log = await ch.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelDelete, limit: 1 });
    const exe = log.entries.first()?.executor;
    if (exe && exe.id !== CONFIG.OWNER_ID) {
      await sendSecurityAlert('⚠️ CHANNEL DELETED', `**Channel:** ${ch.name}\n**Executor:** ${exe.tag}\n**Server:** ${ch.guild.name}`, 0xff0000);
    }
  } catch (e) {}
});

client.on('channelCreate', async (ch) => {
  try {
    const log = await ch.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelCreate, limit: 1 });
    const exe = log.entries.first()?.executor;
    if (exe && exe.id !== CONFIG.OWNER_ID) {
      await sendSecurityAlert('⚠️ CHANNEL CREATED', `**Channel:** ${ch.name}\n**Executor:** ${exe.tag}\n**Server:** ${ch.guild.name}`, 0xffaa00);
    }
  } catch (e) {}
});

client.on('guildMemberRemove', async (member) => {
  try {
    const log = await member.guild.fetchAuditLogs({ type: AuditLogEvent.MemberKick, limit: 1 });
    const exe = log.entries.first()?.executor;
    if (exe && exe.id !== CONFIG.OWNER_ID && member.id !== member.user.id) {
      await sendSecurityAlert('⚠️ MEMBER KICKED', `**Member:** ${member.user.tag}\n**Executor:** ${exe.tag}\n**Server:** ${member.guild.name}`, 0xffaa00);
    }
  } catch (e) {}
});

client.on('guildBanAdd', async (ban) => {
  try {
    const log = await ban.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 1 });
    const exe = log.entries.first()?.executor;
    if (exe && exe.id !== CONFIG.OWNER_ID) {
      await sendSecurityAlert('⚠️ MEMBER BANNED', `**Member:** ${ban.user.tag}\n**Executor:** ${exe.tag}\n**Server:** ${ban.guild.name}`, 0xff0000);
    }
  } catch (e) {}
});

client.on('webhookUpdate', async (ch) => {
  try {
    const log = await ch.guild.fetchAuditLogs({ type: AuditLogEvent.WebhookCreate, limit: 1 });
    const exe = log.entries.first()?.executor;
    if (exe && exe.id !== CONFIG.OWNER_ID) {
      await sendSecurityAlert('⚠️ WEBHOOK CREATED', `**Channel:** ${ch.name}\n**Executor:** ${exe.tag}\n**Server:** ${ch.guild.name}`, 0xffaa00);
    }
  } catch (e) {}
});

client.on('messageDeleteBulk', async (messages) => {
  try {
    const channel = messages.first()?.channel;
    if (channel) {
      await sendSecurityAlert('⚠️ MASS MESSAGE DELETE', `**Channel:** ${channel.name}\n**Messages deleted:** ${messages.size}\n**Server:** ${channel.guild?.name}`, 0xffaa00);
    }
  } catch (e) {}
});

// ========== FETCH RATES ==========
async function fetchLiveRates() {
  try {
    const res = await axios.get('https://api.binance.com/api/v3/ticker/price?symbol=LTCUSDT', { timeout: 5000 });
    if (res.data?.price) liveRates.ltc = parseFloat(res.data.price);
    console.log(`📊 Rate updated: 1 LTC = $${liveRates.ltc}`);
  } catch (e) {}
}
setInterval(fetchLiveRates, 2 * 60 * 60 * 1000);

// ========== READY EVENT ==========
client.once('ready', async () => {
  console.log(`🛡️ GamerProtect online as ${client.user?.tag}`);
  console.log(`📁 Using category: ${CONFIG.TICKET_CATEGORY_ID}`);
  await fetchLiveRates();
  loadData();
  await sendSecurityAlert('✅ BOT ONLINE', `GamerProtect is now online monitoring ${client.guilds.cache.size} servers!`, 0x00ff00);

  const rest = new REST({ version: '10' }).setToken(client.token);
  await rest.put(Routes.applicationCommands(client.user.id), {
    body: [
      new SlashCommandBuilder().setName('close').setDescription('Close ticket (Admin)'),
      new SlashCommandBuilder().setName('say').setDescription('Make bot say something (Owner)')
        .addStringOption(o => o.setName('message').setDescription('What to say').setRequired(true))
        .addChannelOption(o => o.setName('channel').setDescription('Channel to send to'))
    ]
  });

  const panelCh = client.channels.cache.get(CONFIG.TICKET_CHANNEL_ID);
  if (panelCh) {
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('crypto_select')
        .setPlaceholder('💰 Select cryptocurrency')
        .addOptions(
          { label: '📀 Litecoin (LTC)', value: 'ltc', emoji: '💎' },
          { label: '💵 Tether USDT (BEP-20)', value: 'usdt', emoji: '💰' }
        )
    );
    const embed = new EmbedBuilder()
      .setTitle('# 🛡️ GamerProtect Escrow Service')
      .setColor(0x9b59b6)
      .setDescription('**Welcome to GamerProtect - The #1 Gaming Escrow Service!**\n\nClick below to start a secure trade.')
      .addFields(
        { name: '📋 **How it works**', value: '```\n1️⃣ Select your cryptocurrency\n2️⃣ Fill in trade details\n3️⃣ Both parties confirm roles\n4️⃣ Buyer sends crypto to escrow\n5️⃣ Seller sends items/goods\n6️⃣ Funds released to buyer\n```', inline: false },
        { name: '💰 **Fee Structure**', value: `• Trades **$${FEES.over250Threshold}+**: **$${FEES.over250}**\n• Trades under **$${FEES.over250Threshold}**: **$${FEES.under250}**\n• Trades under **$${FEES.freeThreshold}**: **FREE**`, inline: true },
        { name: '📊 **Current Rate**', value: `1 LTC = **$${liveRates.ltc.toFixed(2)}** USD`, inline: true },
        { name: '🔒 **Security Features**', value: '• 24/7 Escrow Protection\n• Dedicated Middlemen\n• Fast & Secure Transactions\n• Staff never DM first\n• Blockchain verification', inline: false }
      )
      .setFooter({ text: 'GamerProtect - Secure Gaming Trades' })
      .setTimestamp();
    await panelCh.send({ embeds: [embed], components: [row] });
    console.log('✅ Ticket panel created');
  }

  const announceCh = client.channels.cache.get(CONFIG.ANNOUNCEMENTS_CHANNEL_ID);
  if (announceCh) {
    const announceEmbed = new EmbedBuilder()
      .setTitle('# 🛡️ GamerProtect is LIVE!')
      .setColor(0x9b59b6)
      .setDescription('**The Ultimate Gaming Escrow Service is now available!**')
      .addFields(
        { name: '✨ **What is GamerProtect?**', value: 'GamerProtect is a secure escrow service that protects both buyers and sellers in gaming trades. We hold funds until both parties confirm, eliminating scams completely.', inline: false },
        { name: '📌 **How to Start a Trade**', value: `1. Go to <#${CONFIG.TICKET_CHANNEL_ID}>\n2. Select your cryptocurrency\n3. Fill in the trade details\n4. Complete the secure trade`, inline: false },
        { name: '🎮 **Supported Games**', value: '• CS:GO / CS2\n• Rust\n• Roblox\n• Fortnite\n• Valorant\n• And any other game!', inline: true },
        { name: '💰 **Earn GP Coins**', value: 'Complete trades, claim daily bonuses, and earn achievements to unlock exclusive perks! Use `!daily` to start.', inline: true }
      )
      .setFooter({ text: 'GamerProtect - The #1 Gaming Escrow Service' })
      .setTimestamp();
    await announceCh.send({ embeds: [announceEmbed] });
    console.log('✅ Announcement sent');
  }
});

// ========== TICKET CREATION ==========
client.on('interactionCreate', async (i) => {
  if (!i.isStringSelectMenu() || i.customId !== 'crypto_select') return;

  const modal = new ModalBuilder()
    .setCustomId(`trade_form_${i.user.id}`)
    .setTitle('Create New Trade');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('buyer').setLabel("Buyer's Username/ID (Receives Crypto)").setStyle(TextInputStyle.Short).setPlaceholder('@username or Discord ID').setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('seller_item').setLabel("Seller's Items/Goods (What they are giving)").setStyle(TextInputStyle.Paragraph).setPlaceholder('Describe the item, account, or goods being sold').setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('buyer_item').setLabel("Buyer's Crypto Amount").setStyle(TextInputStyle.Short).setPlaceholder('e.g., 0.5 LTC or $100 USDT').setRequired(true)
    )
  );

  stepStates.set(`temp_${i.user.id}`, { crypto: i.values[0] });
  await i.showModal(modal);
});

// ========== FORM SUBMISSION ==========
client.on('interactionCreate', async (i) => {
  if (!i.isModalSubmit() || !i.customId.startsWith('trade_form_')) return;

  await i.deferReply({ flags: 64 });
  const temp = stepStates.get(`temp_${i.customId.split('_')[2]}`);
  if (!temp) return i.editReply('❌ Session expired');

  const buyerInput = i.fields.getTextInputValue('buyer');
  const sellerItem = i.fields.getTextInputValue('seller_item');
  const buyerItem = i.fields.getTextInputValue('buyer_item');

  let buyerId = null, buyerName = buyerInput;
  const match = buyerInput.match(/\d{17,19}/);
  if (match) {
    try {
      const u = await client.users.fetch(match[0]);
      buyerId = u.id;
      buyerName = u.username;
    } catch (e) {}
  }

  const ticketNum = Math.floor(Math.random() * 9000) + 1000;
  const ch = await i.guild.channels.create({
    name: `trade-${i.user.username}-${ticketNum}`,
    type: ChannelType.GuildText,
    parent: CONFIG.TICKET_CATEGORY_ID,
    permissionOverwrites: [
      { id: i.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: i.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
    ]
  });

  if (buyerId) {
    await ch.permissionOverwrites.create(buyerId, {
      ViewChannel: true, SendMessages: true, ReadMessageHistory: true
    });
  }

  trades.set(ch.id, {
    crypto: temp.crypto,
    ticketNumber: ticketNum,
    sellerId: i.user.id,
    sellerName: i.user.username,
    buyerId: buyerId,
    buyerName: buyerName,
    sellerItem: sellerItem,
    buyerItem: buyerItem,
    amountUSD: null,
    amountCrypto: null,
    feeUSD: 0,
    feePayer: null,
    status: 'waiting_roles',
    channelId: ch.id,
    exchangeRateUsed: liveRates[temp.crypto],
    paymentConfirmed: false,
    createdAt: Date.now()
  });

  await i.editReply(`✅ Ticket created! ${ch}`);

  const embed = new EmbedBuilder()
    .setTitle(`🛡️ GamerProtect Escrow - Trade #${ticketNum}`)
    .setColor(0x9b59b6)
    .setDescription(`**Welcome to your secure escrow ticket!** Please select your roles below.`)
    .addFields(
      { name: '📤 **Seller (Sends Items)**', value: `${i.user}\n**Giving:** ${sellerItem}`, inline: true },
      { name: '📥 **Buyer (Sends Crypto)**', value: buyerId ? `<@${buyerId}>` : buyerName, inline: true },
      { name: '💎 **Cryptocurrency**', value: temp.crypto.toUpperCase(), inline: true },
      { name: '📝 **Trade Details**', value: `\`\`\`\nSeller gives: ${sellerItem}\nBuyer gives: ${buyerItem}\nCrypto: ${temp.crypto.toUpperCase()}\nEscrow: GamerProtect Secure\n\`\`\``, inline: false },
      { name: '🔒 **Security Reminders**', value: '• Staff will **NEVER** DM you first\n• Always verify payments on blockchain\n• Never release items before payment confirmation\n• Save all conversation screenshots', inline: false }
    )
    .setFooter({ text: `Trade ID: #${ticketNum} | Created: ${new Date().toLocaleString()}` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`seller_${ch.id}`).setLabel('📤 I am Seller (Sends Items)').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`buyer_${ch.id}`).setLabel('📥 I am Buyer (Sends Crypto)').setStyle(ButtonStyle.Success)
  );

  await ch.send({ embeds: [embed], components: [row] });
  stepStates.delete(`temp_${i.customId.split('_')[2]}`);
});

// ========== ROLE SELECTION ==========
client.on('interactionCreate', async (i) => {
  if (!i.isButton()) return;

  if (i.customId.startsWith('seller_')) {
    const id = i.customId.split('_')[1];
    const t = trades.get(id);
    if (!t) return;
    t.sellerId = i.user.id;
    trades.set(id, t);
    await i.reply({ content: '✅ You are the **Seller** (you will send ITEMS to the buyer)', flags: 64 });

    if (t.sellerId && t.buyerId && !roleConfirmations.has(id)) {
      roleConfirmations.set(id, []);
      const embed = new EmbedBuilder()
        .setTitle('✅ Confirm Roles')
        .setColor(0xff9900)
        .setDescription(`**Seller (Sends Items):** <@${t.sellerId}>\n**Buyer (Sends Crypto):** <@${t.buyerId}>\n\n**Please confirm these roles are correct.**`)
        .setFooter({ text: 'Both parties must click confirm to continue' });
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`confirm_roles_${id}`).setLabel('✅ Confirm').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`incorrect_roles_${id}`).setLabel('❌ Incorrect').setStyle(ButtonStyle.Danger)
      );
      await i.channel.send({ embeds: [embed], components: [row] });
    }
  }

  if (i.customId.startsWith('buyer_')) {
    const id = i.customId.split('_')[1];
    const t = trades.get(id);
    if (!t) return;
    t.buyerId = i.user.id;
    trades.set(id, t);
    await i.reply({ content: '✅ You are the **Buyer** (you will send CRYPTO to escrow)', flags: 64 });

    if (t.sellerId && t.buyerId && !roleConfirmations.has(id)) {
      roleConfirmations.set(id, []);
      const embed = new EmbedBuilder()
        .setTitle('✅ Confirm Roles')
        .setColor(0xff9900)
        .setDescription(`**Seller (Sends Items):** <@${t.sellerId}>\n**Buyer (Sends Crypto):** <@${t.buyerId}>\n\n**Please confirm these roles are correct.**`)
        .setFooter({ text: 'Both parties must click confirm to continue' });
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`confirm_roles_${id}`).setLabel('✅ Confirm').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`incorrect_roles_${id}`).setLabel('❌ Incorrect').setStyle(ButtonStyle.Danger)
      );
      await i.channel.send({ embeds: [embed], components: [row] });
    }
  }
});

// ========== ROLE CONFIRMATION ==========
client.on('interactionCreate', async (i) => {
  if (!i.isButton()) return;

  if (i.customId.startsWith('confirm_roles_')) {
    const id = i.customId.split('_')[2];
    const t = trades.get(id);
    if (!t) return;
    const confirmed = roleConfirmations.get(id) || [];
    if (!confirmed.includes(i.user.id)) {
      confirmed.push(i.user.id);
      roleConfirmations.set(id, confirmed);
      await i.reply({ content: `✅ ${i.user.username} confirmed the roles`, flags: 64 });
    }
    if (confirmed.length === 2) {
      roleConfirmations.delete(id);
      const embed = new EmbedBuilder()
        .setTitle('💰 Set Trade Amount')
        .setColor(0x9b59b6)
        .setDescription(`<@${t.sellerId}>, please set the USD amount for this trade.`)
        .addFields(
          { name: '📝 **Example**', value: '`50`, `250`, `1000`', inline: true },
          { name: '💰 **Fee Structure**', value: `• $${FEES.over250Threshold}+: **$${FEES.over250}**\n• Under $${FEES.over250Threshold}: **$${FEES.under250}**\n• Under $${FEES.freeThreshold}: **FREE**`, inline: true },
          { name: '⚠️ **Important**', value: 'The fee is added to the total amount the buyer must send.', inline: false }
        )
        .setFooter({ text: 'The seller sets the amount based on the trade value' });
      const btn = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`set_amount_${id}`).setLabel('💰 Set Amount').setStyle(ButtonStyle.Primary)
      );
      await i.channel.send({ embeds: [embed], components: [btn] });
    }
  }

  if (i.customId.startsWith('incorrect_roles_')) {
    const id = i.customId.split('_')[2];
    const t = trades.get(id);
    if (!t) return;
    t.sellerId = null;
    t.buyerId = null;
    trades.set(id, t);
    roleConfirmations.delete(id);
    await i.reply({ content: '🔄 Roles have been reset. Please select again.', flags: 64 });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`seller_${id}`).setLabel('📤 Seller').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`buyer_${id}`).setLabel('📥 Buyer').setStyle(ButtonStyle.Success)
    );
    await i.channel.send({ content: 'Select your roles:', components: [row] });
  }
});

// ========== SET AMOUNT ==========
client.on('interactionCreate', async (i) => {
  if (!i.isButton() || !i.customId.startsWith('set_amount_')) return;

  const id = i.customId.split('_')[2];
  const t = trades.get(id);
  if (!t) return;
  if (i.user.id !== t.sellerId) return i.reply({ content: '❌ Only the seller can set the trade amount', flags: 64 });

  const modal = new ModalBuilder()
    .setCustomId(`amount_modal_${id}`)
    .setTitle('Set Trade Amount');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('amount').setLabel('USD Amount').setStyle(TextInputStyle.Short).setPlaceholder('Enter amount in USD (e.g., 50, 250, 1000)').setRequired(true)
    )
  );
  await i.showModal(modal);
});

// ========== HANDLE AMOUNT ==========
client.on('interactionCreate', async (i) => {
  if (!i.isModalSubmit() || !i.customId.startsWith('amount_modal_')) return;

  await i.deferReply({ flags: 64 });
  const id = i.customId.split('_')[2];
  const t = trades.get(id);
  if (!t) return;

  const amount = parseFloat(i.fields.getTextInputValue('amount'));
  if (isNaN(amount) || amount <= 0) return i.editReply('❌ Invalid amount. Please enter a positive number.');

  t.amountUSD = amount;
  const rate = liveRates[t.crypto];
  t.amountCrypto = (amount / rate).toFixed(8);
  t.feeUSD = amount >= 250 ? 1.50 : amount >= 50 ? 0.50 : 0;
  trades.set(id, t);

  const embed = new EmbedBuilder()
    .setTitle('💰 Trade Summary')
    .setColor(0x9b59b6)
    .setDescription(`**Trade #${t.ticketNumber}**`)
    .addFields(
      { name: '💵 **Amount**', value: `$${amount.toFixed(2)} USD`, inline: true },
      { name: '💎 **Crypto**', value: `${t.amountCrypto} ${t.crypto.toUpperCase()}`, inline: true },
      { name: '📊 **Exchange Rate**', value: `1 ${t.crypto.toUpperCase()} = $${rate.toFixed(2)}`, inline: true },
      { name: '💸 **Fee**', value: t.feeUSD > 0 ? `$${t.feeUSD}` : 'FREE', inline: true },
      { name: '📤 **Seller**', value: `<@${t.sellerId}>`, inline: true },
      { name: '📥 **Buyer**', value: `<@${t.buyerId}>`, inline: true }
    )
    .setFooter({ text: 'Please confirm the amount is correct' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`confirm_amount_${id}`).setLabel('✅ Confirm Amount').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`incorrect_amount_${id}`).setLabel('❌ Incorrect').setStyle(ButtonStyle.Danger)
  );

  await i.editReply('✅ Amount has been set!');
  await i.channel.send({ embeds: [embed], components: [row] });
  amountConfirmations.set(id, []);
});

// ========== AMOUNT CONFIRMATION ==========
client.on('interactionCreate', async (i) => {
  if (!i.isButton()) return;

  if (i.customId.startsWith('confirm_amount_')) {
    const id = i.customId.split('_')[2];
    const t = trades.get(id);
    if (!t) return;
    const confirmed = amountConfirmations.get(id) || [];
    if (!confirmed.includes(i.user.id)) {
      confirmed.push(i.user.id);
      amountConfirmations.set(id, confirmed);
      await i.reply({ content: `✅ ${i.user.username} confirmed the amount`, flags: 64 });
    }
    if (confirmed.length === 2) {
      amountConfirmations.delete(id);
      await sendPaymentInvoice(i.channel, t);
    }
  }

  if (i.customId.startsWith('incorrect_amount_')) {
    const id = i.customId.split('_')[2];
    const t = trades.get(id);
    if (!t) return;
    const btn = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`set_amount_${id}`).setLabel('💰 Set Amount').setStyle(ButtonStyle.Primary)
    );
    await i.reply({ content: '❌ Please set the correct amount', flags: 64 });
    await i.channel.send({ content: `<@${t.sellerId}>`, components: [btn] });
    amountConfirmations.delete(id);
  }
});

// ========== SEND PAYMENT INVOICE (ONLY DMS THE SENDER IF THEY HAVE MM ROLE) ==========
async function sendPaymentInvoice(channel, trade) {
  const rate = trade.exchangeRateUsed || liveRates[trade.crypto];
  let totalUSD = trade.amountUSD;
  let feeText = '';
  
  if (trade.feePayer === trade.sellerId) {
    totalUSD = trade.amountUSD + trade.feeUSD;
    feeText = `Seller pays: $${trade.feeUSD}`;
  } else if (trade.feePayer === trade.buyerId) {
    totalUSD = trade.amountUSD + trade.feeUSD;
    feeText = `Buyer pays: $${trade.feeUSD}`;
  } else if (trade.feePayer === 'split') {
    totalUSD = trade.amountUSD + (trade.feeUSD / 2);
    feeText = `Split 50/50: $${(trade.feeUSD / 2).toFixed(2)} each`;
  } else {
    feeText = 'FREE';
  }
  
  const totalCrypto = (totalUSD / rate).toFixed(8);
  
  const invoiceEmbed = new EmbedBuilder()
    .setTitle('🛡️ Payment Required - Send Crypto to Escrow')
    .setColor(0x9b59b6)
    .setDescription(`**Trade #${trade.ticketNumber}**\n\nPlease send the exact amount to the GamerProtect escrow address below.`)
    .addFields(
      { name: '🏦 **Escrow Address**', value: `\`\`\`${CONFIG.LTC_WALLET_ADDRESS}\`\`\``, inline: false },
      { name: '💰 **Amount to Send**', value: `${totalCrypto} ${trade.crypto.toUpperCase()}`, inline: true },
      { name: '💵 **USD Value**', value: `$${totalUSD.toFixed(2)}`, inline: true },
      { name: '💸 **Fee**', value: feeText, inline: true },
      { name: '⚠️ **Important Instructions**', value: '• Send the **EXACT** amount shown above\n• Double-check the address before sending\n• Funds are held in escrow until both parties confirm\n• Screenshot your transaction for proof', inline: false }
    )
    .setFooter({ text: `Trade #${trade.ticketNumber} | Send EXACT amount` });
  
  const copyRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`copy_${trade.channelId}`).setLabel('📋 Copy Address').setStyle(ButtonStyle.Secondary)
  );
  
  await channel.send({ embeds: [invoiceEmbed], components: [copyRow] });
  trade.totalUSD = totalUSD;
  trades.set(trade.channelId, trade);
  
  // ONLY DM THE SENDER IF THEY HAVE THE MIDDLEMAN ROLE
  const sender = channel.guild.members.cache.get(trade.sellerId);
  const middlemanRole = channel.guild.roles.cache.get(CONFIG.MIDDLEMAN_ROLE_ID);
  
  if (sender && middlemanRole && sender.roles.cache.has(CONFIG.MIDDLEMAN_ROLE_ID)) {
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
        { name: '📤 **Seller**', value: `<@${trade.sellerId}>`, inline: true },
        { name: '📥 **Buyer**', value: `<@${trade.buyerId}>`, inline: true },
        { name: '💰 **Amount**', value: `${totalCrypto} ${trade.crypto.toUpperCase()}`, inline: true },
        { name: '💵 **USD Value**', value: `$${totalUSD.toFixed(2)}`, inline: true },
        { name: '💸 **Fee**', value: trade.feeUSD > 0 ? `$${trade.feeUSD}` : 'FREE', inline: true }
      )
      .setFooter({ text: 'Only click Confirm after verifying the payment on the blockchain' });
    
    try {
      await sender.send({ embeds: [dmEmbed], components: [confirmRow] });
      console.log(`📨 DM sent to seller (has MM role): ${sender.user.tag}`);
    } catch(e) {
      console.log(`❌ Could not DM seller: ${e.message}`);
    }
  } else {
    console.log(`⚠️ Seller ${trade.sellerId} does not have middleman role. No DM sent.`);
  }
}

// ========== DM CONFIRMATION HANDLER ==========
client.on('interactionCreate', async (i) => {
  if (!i.isButton() || !i.customId.startsWith('dm_confirm_')) return;
  
  const id = i.customId.split('_')[2];
  const trade = trades.get(id);
  if (!trade) return;
  if (trade.paymentConfirmed) return i.reply({ content: '✅ Payment already confirmed!', flags: 64 });
  
  trade.paymentConfirmed = true;
  trades.set(id, trade);
  await i.reply({ content: '✅ Payment confirmed! Thank you.', flags: 64 });
  
  const ticket = await client.channels.fetch(id);
  if (ticket) {
    const confirmedEmbed = new EmbedBuilder()
      .setTitle('✅ Payment Confirmed on Blockchain!')
      .setColor(0x00ff00)
      .setDescription(`**Trade #${trade.ticketNumber}**\n\nThe crypto payment has been verified on the blockchain!`)
      .addFields(
        { name: '💰 **Amount**', value: `${trade.amountCrypto} ${trade.crypto.toUpperCase()}`, inline: true },
        { name: '💵 **USD Value**', value: `$${trade.amountUSD}`, inline: true }
      )
      .setFooter({ text: 'The seller may now release funds after sending items' });
    
    await ticket.send({ embeds: [confirmedEmbed] });
    await delay(2000);
    
    const proceedEmbed = new EmbedBuilder()
      .setTitle('📦 Proceed with Trade')
      .setColor(0x00ff00)
      .setDescription(`**Step-by-Step Instructions:**`)
      .addFields(
        { name: '1️⃣ **Seller Sends Items**', value: `<@${trade.sellerId}> - Send the items/goods to <@${trade.buyerId}>`, inline: false },
        { name: '2️⃣ **Seller Confirms**', value: `Once you have sent the items, click **Release Funds** below`, inline: false },
        { name: '3️⃣ **Buyer Receives Crypto**', value: `The buyer will enter their wallet address and receive the crypto payment`, inline: false },
        { name: '⚠️ **Important Warning**', value: '**DO NOT** release funds until you have received ALL items as agreed. This action cannot be undone!', inline: false }
      )
      .setFooter({ text: 'Only release funds after receiving items!' });
    
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`release_${id}`).setLabel('🔓 Release Funds').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`cancel_${id}`).setLabel('❌ Cancel Trade').setStyle(ButtonStyle.Danger)
    );
    await ticket.send({ embeds: [proceedEmbed], components: [row] });
  }
});

// ========== RELEASE FUNDS ==========
client.on('interactionCreate', async (i) => {
  if (!i.isButton()) return;

  if (i.customId.startsWith('release_')) {
    const id = i.customId.split('_')[1];
    const t = trades.get(id);
    if (!t) return;
    if (i.user.id !== t.sellerId) return i.reply({ content: '❌ Only the seller can release funds!', flags: 64 });
    if (!t.paymentConfirmed) return i.reply({ content: '❌ Payment has not been confirmed yet!', flags: 64 });

    const embed = new EmbedBuilder()
      .setTitle('📥 Enter Your Wallet Address')
      .setColor(0x9b59b6)
      .setDescription(`<@${t.buyerId}>, the seller has released the funds!\n\nClick the button below to enter your ${t.crypto.toUpperCase()} wallet address to receive payment.`)
      .addFields(
        { name: '💰 **Amount to Receive**', value: `${t.amountCrypto} ${t.crypto.toUpperCase()}`, inline: true },
        { name: '💵 **USD Value**', value: `$${t.amountUSD}`, inline: true },
        { name: '🔒 **Privacy**', value: 'Your wallet address is only visible to staff', inline: true }
      )
      .setFooter({ text: 'Enter your wallet address to receive funds' });
    
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`wallet_${id}`).setLabel('💳 Enter Wallet Address').setStyle(ButtonStyle.Success)
    );
    await i.reply({ content: `✅ Release initiated! Waiting for <@${t.buyerId}>...`, flags: 64 });
    await i.channel.send({ content: `<@${t.buyerId}>`, embeds: [embed], components: [row] });
  }

  if (i.customId.startsWith('wallet_')) {
    const id = i.customId.split('_')[1];
    const t = trades.get(id);
    if (!t) return;
    if (i.user.id !== t.buyerId) return i.reply({ content: '❌ Only the buyer can enter their wallet address!', flags: 64 });

    const modal = new ModalBuilder()
      .setCustomId(`wallet_modal_${id}`)
      .setTitle(`Enter Your ${t.crypto.toUpperCase()} Wallet Address`);
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('wallet')
          .setLabel(`${t.crypto.toUpperCase()} Wallet Address`)
          .setStyle(TextInputStyle.Short)
          .setPlaceholder(t.crypto === 'ltc' ? 'Enter your LTC wallet address' : 'Enter your USDT wallet address (BEP-20)')
          .setRequired(true)
      )
    );
    await i.showModal(modal);
  }

  if (i.customId.startsWith('cancel_')) {
    const id = i.customId.split('_')[1];
    await i.reply({ content: '❌ Trade cancelled. Closing ticket...', flags: 64 });
    setTimeout(async () => {
      const ch = await client.channels.fetch(id);
      if (ch) await ch.delete();
    }, 5000);
  }

  if (i.customId.startsWith('copy_')) {
    await i.reply({ content: `📋 Escrow address copied!\n\`${CONFIG.LTC_WALLET_ADDRESS}\``, flags: 64 });
  }
});

// ========== WALLET SUBMISSION & COMPLETION (NO $MERCY) ==========
client.on('interactionCreate', async (i) => {
  if (!i.isModalSubmit() || !i.customId.startsWith('wallet_modal_')) return;

  await i.deferReply({ flags: 64 });
  const id = i.customId.split('_')[2];
  const t = trades.get(id);
  if (!t) return;
  if (i.user.id !== t.buyerId) return i.editReply('❌ Only the buyer can submit their wallet address!');

  const wallet = i.fields.getTextInputValue('wallet');

  const completionEmbed = new EmbedBuilder()
    .setTitle('✅ Trade Completed Successfully!')
    .setColor(0x00ff00)
    .setDescription(`**Trade #${t.ticketNumber}** has been completed!`)
    .addFields(
      { name: '💰 **Amount Sent**', value: `${t.amountCrypto} ${t.crypto.toUpperCase()}`, inline: true },
      { name: '💵 **USD Value**', value: `$${t.amountUSD}`, inline: true },
      { name: '📤 **Seller**', value: `<@${t.sellerId}>`, inline: true },
      { name: '📥 **Buyer**', value: `<@${t.buyerId}>`, inline: true },
      { name: '🏦 **Buyer Wallet**', value: `\`${wallet}\``, inline: false },
      { name: '⭐ **Reputation Earned**', value: '+5 rep for both parties', inline: true },
      { name: '🛡️ **Escrow Service**', value: 'GamerProtect - Secure Gaming Trades', inline: true }
    )
    .setFooter({ text: 'Thank you for using GamerProtect!' })
    .setTimestamp();

  await i.channel.send({ embeds: [completionEmbed] });
  await i.editReply('✅ Wallet address received! Trade completed successfully.');

  const seller = getUser(t.sellerId);
  const buyer = getUser(t.buyerId);
  seller.rep += 5;
  buyer.rep += 5;
  seller.totalTrades += 1;
  buyer.totalTrades += 1;
  saveUser(t.sellerId, seller);
  saveUser(t.buyerId, buyer);

  const logCh = client.channels.cache.get(CONFIG.LOGS_CHANNEL_ID);
  if (logCh) await logCh.send({ embeds: [completionEmbed] });

  t.status = 'completed';
  trades.set(id, t);

  setTimeout(async () => {
    try {
      await i.channel.send('🔒 Ticket will close in 5 seconds...');
      setTimeout(async () => {
        if (i.channel.deletable) await i.channel.delete();
      }, 5000);
    } catch (e) {}
  }, 10000);
});

// ========== OWNER COMMANDS ==========
client.on('messageCreate', async (m) => {
  if (m.author.bot) return;
  if (m.author.id !== CONFIG.OWNER_ID) return;

  if (m.content.startsWith('!check')) {
    const target = m.mentions.users.first();
    if (!target) return m.reply('Usage: !check @user');
    await m.reply(`🔍 Checking for accounts similar to ${target.username}...`);
    const similar = await findSimilarUsers(m.guild, target);
    if (similar.length === 0) return m.reply('No similar accounts found.');
    const embed = new EmbedBuilder().setTitle(`Similar Accounts to ${target.username}`).setColor(0x9b59b6);
    for (const u of similar) {
      embed.addFields({ name: `${u.username} (${u.similarity}% match)`, value: `ID: ${u.id}\nJoined: ${u.joinDate.toLocaleDateString()}`, inline: false });
    }
    await m.reply({ embeds: [embed] });
  }

  if (m.content.startsWith('!addgp')) {
    const args = m.content.split(' ');
    let target = m.author, amount = parseInt(args[1]);
    if (m.mentions.users.size > 0) { target = m.mentions.users.first(); amount = parseInt(args[2]); }
    if (isNaN(amount)) return m.reply('Usage: !addgp 500 or !addgp @user 500');
    const u = getUser(target.id);
    u.balance += amount;
    saveUser(target.id, u);
    await m.reply(`✅ Added ${amount} GP to ${target.username}! New balance: ${u.balance}`);
  }

  if (m.content === '!resetgp') {
    let c = 0;
    for (const [id, u] of userData.entries()) { u.balance = 0; saveUser(id, u); c++; }
    await m.reply(`✅ Reset ${c} users to 0 GP`);
  }

  if (m.content === '!allbalances') {
    const sorted = Array.from(userData.entries()).sort((a, b) => (b[1].balance || 0) - (a[1].balance || 0)).slice(0, 20);
    let text = '💰 Top 20 GP Balances 💰\n\n';
    for (let i = 0; i < sorted.length; i++) {
      try { const u = await client.users.fetch(sorted[i][0]); text += `${i+1}. ${u.username} - ${sorted[i][1].balance || 0} GP (${sorted[i][1].totalTrades || 0} trades)\n`; } catch(e) {}
    }
    await m.reply(text);
  }

  if (m.content.startsWith('!say')) {
    const text = m.content.slice(4).trim();
    if (!text) return m.reply('Usage: !say hello');
    const channelMatch = text.match(/^<#(\d+)>\s+(.+)/);
    let targetCh = m.channel, textToSay = text;
    if (channelMatch) {
      const chId = channelMatch[1];
      textToSay = channelMatch[2];
      targetCh = m.guild.channels.cache.get(chId);
      if (!targetCh) return m.reply('Channel not found!');
    }
    try {
      await targetCh.send(textToSay);
      await m.reply(`✅ Said in ${targetCh}`);
    } catch (e) { await m.reply(`❌ Failed: ${e}`); }
  }

  if (m.content === '!panel') {
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('crypto_select')
        .setPlaceholder('💰 Select cryptocurrency')
        .addOptions(
          { label: '📀 Litecoin (LTC)', value: 'ltc', emoji: '💎' },
          { label: '💵 Tether USDT', value: 'usdt', emoji: '💰' }
        )
    );
    const embed = new EmbedBuilder()
      .setTitle('🛡️ GamerProtect Escrow')
      .setColor(0x9b59b6)
      .setDescription('**Secure Escrow for Gaming Trades**\n\nClick below to start a trade.')
      .addFields(
        { name: '💰 Fees', value: `• $250+: $${FEES.over250}\n• Under $250: $${FEES.under250}\n• Under $50: FREE`, inline: true },
        { name: '📊 Rate', value: `1 LTC = $${liveRates.ltc.toFixed(2)}`, inline: true }
      );
    await m.channel.send({ embeds: [embed], components: [row] });
    await m.reply('✅ Panel sent!');
  }

  if (m.content.startsWith('!givemm')) {
    const target = m.mentions.users.first();
    if (!target) return m.reply('Usage: !givemm @user');
    const member = m.guild.members.cache.get(target.id);
    const role = m.guild.roles.cache.get(CONFIG.MIDDLEMAN_ROLE_ID);
    if (!role) return m.reply('Role not found');
    await member.roles.add(role);
    await m.reply(`✅ ${target.tag} is now a GamerProtect Middleman!`);
  }

  if (m.content.startsWith('!removemm')) {
    const target = m.mentions.users.first();
    if (!target) return m.reply('Usage: !removemm @user');
    const member = m.guild.members.cache.get(target.id);
    const role = m.guild.roles.cache.get(CONFIG.MIDDLEMAN_ROLE_ID);
    if (member && role) await member.roles.remove(role);
    await m.reply(`✅ ${target.tag} removed from Middleman`);
  }

  if (m.content === '!listmm') {
    const role = m.guild.roles.cache.get(CONFIG.MIDDLEMAN_ROLE_ID);
    if (!role) return m.reply('Middleman role not found');
    const members = role.members.map(r => `• ${r.user.tag} (${r.id})`);
    if (members.length === 0) return m.reply('No middlemen have the role yet.');
    await m.reply(`🛡️ **GamerProtect Middlemen:**\n${members.join('\n')}`);
  }
});

// ========== PUBLIC ECONOMY COMMANDS ==========
client.on('messageCreate', async (m) => {
  if (m.author.bot) return;

  if (m.content === '!balance') {
    const u = getUser(m.author.id);
    await m.reply(`💰 **${m.author.username}** has **${u.balance} GP**\n⭐ Reputation: ${u.rep}\n📊 Total Trades: ${u.totalTrades || 0}`);
  }

  if (m.content === '!rep') {
    const u = getUser(m.author.id);
    await m.reply(`⭐ **${m.author.username}** has **${u.rep}** reputation points!`);
  }

  if (m.content === '!daily') {
    const u = getUser(m.author.id);
    const now = Date.now();
    if (now - (u.lastDaily || 0) < 86400000) {
      const hours = Math.ceil(24 - (now - (u.lastDaily || 0)) / 3600000);
      return m.reply(`⏰ Come back in ${hours} hours!`);
    }
    const reward = 25 + Math.floor(Math.random() * 50) + Math.floor((u.streak || 0) / 3) * 15;
    u.balance += reward;
    u.lastDaily = now;
    u.streak = (u.streak || 0) + 1;
    saveUser(m.author.id, u);
    await m.reply(`🎁 **Daily Claimed!** +${reward} GP\n🔥 Streak: ${u.streak} days\n💰 Balance: ${u.balance} GP`);
  }

  if (m.content === '!streak') {
    const u = getUser(m.author.id);
    await m.reply(`🔥 **${m.author.username}** is on a **${u.streak || 0} day streak!**`);
  }

  if (m.content.startsWith('!gamble')) {
    const args = m.content.split(' ');
    const amount = parseInt(args[1]);
    const u = getUser(m.author.id);
    if (isNaN(amount) || amount <= 0) return m.reply('Usage: !gamble 50');
    if (u.balance < amount) return m.reply(`❌ You only have ${u.balance} GP!`);
    const win = Math.random() < 0.4;
    if (win) {
      u.balance += amount;
      saveUser(m.author.id, u);
      await m.reply(`🎲 **YOU WON!** +${amount} GP! New balance: ${u.balance} GP 🎉`);
    } else {
      u.balance -= amount;
      saveUser(m.author.id, u);
      await m.reply(`💀 **YOU LOST!** -${amount} GP. New balance: ${u.balance} GP`);
    }
  }

  if (m.content === '!leaderboard') {
    const sorted = Array.from(userData.entries()).sort((a, b) => (b[1].balance || 0) - (a[1].balance || 0)).slice(0, 10);
    let text = '🏆 **Top Traders Leaderboard** 🏆\n\n';
    for (let i = 0; i < sorted.length; i++) {
      try {
        const u = await client.users.fetch(sorted[i][0]);
        text += `${i+1}. ${u.username} - ${sorted[i][1].balance || 0} GP (${sorted[i][1].totalTrades || 0} trades)\n`;
      } catch(e) {}
    }
    await m.reply(text);
  }

  if (m.content.startsWith('!tip')) {
    const args = m.content.split(' ');
    const target = m.mentions.users.first();
    const amount = parseInt(args[2]);
    if (!target) return m.reply('Usage: !tip @user 50');
    if (target.id === m.author.id) return m.reply('Cannot tip yourself');
    if (isNaN(amount) || amount <= 0) return m.reply('Enter valid amount');
    const sender = getUser(m.author.id);
    if (sender.balance < amount) return m.reply(`❌ You only have ${sender.balance} GP!`);
    const receiver = getUser(target.id);
    sender.balance -= amount;
    receiver.balance += amount;
    saveUser(m.author.id, sender);
    saveUser(target.id, receiver);
    await m.reply(`💝 **${m.author.username}** tipped **${amount} GP** to ${target.username}!`);
  }
});

// ========== SLASH COMMANDS ==========
client.on('interactionCreate', async (i) => {
  if (!i.isCommand()) return;

  if (i.commandName === 'close') {
    if (!i.memberPermissions.has('Administrator')) return i.reply({ content: 'Admin only', flags: 64 });
    if (!i.channel.name?.startsWith('trade-')) return i.reply({ content: 'Use in ticket channel', flags: 64 });
    await i.reply('🔒 Closing ticket in 5 seconds...');
    setTimeout(() => i.channel.delete(), 5000);
  }

  if (i.commandName === 'say') {
    if (i.user.id !== CONFIG.OWNER_ID) return i.reply({ content: 'Owner only', flags: 64 });
    const msg = i.options.getString('message', true);
    const ch = i.options.getChannel('channel') || i.channel;
    await i.deferReply({ flags: 64 });
    if (ch?.isTextBased()) await ch.send(msg);
    await i.editReply(`✅ Said in ${ch}`);
  }
});

// ========== LOGIN ==========
const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('❌ DISCORD_TOKEN not found in environment variables!');
  process.exit(1);
}
client.login(token);
