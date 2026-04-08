const {
  Client, GatewayIntentBits, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType, PermissionsBitField, EmbedBuilder,
  SlashCommandBuilder, REST, Routes, AuditLogEvent
} = require('discord.js');
const axios = require('axios');
const fs = require('fs');

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

const DATA_FILE = 'gamerprotect_data.json';
let userData = new Map();
let trades = new Map();
let stepStates = new Map();
let roleConfirmations = new Map();
let amountConfirmations = new Map();
let liveRates = { ltc: 55.83, usdt: 1.00 };

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      if (data.userData) {
        for (const [k, v] of Object.entries(data.userData)) userData.set(k, v);
      }
      console.log(`✅ Loaded ${userData.size} users`);
    }
  } catch (e) {}
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ userData: Object.fromEntries(userData) }, null, 2));
  } catch (e) {}
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

// ========== AUTO-LOG FUNCTION ==========
async function sendLog(title, description, color = 0x9b59b6, fields = []) {
  try {
    const logChannel = client.channels.cache.get(CONFIG.LOGS_CHANNEL_ID);
    if (!logChannel) {
      console.log(`❌ Logs channel not found! ID: ${CONFIG.LOGS_CHANNEL_ID}`);
      return;
    }
    
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(color)
      .setTimestamp();
    
    if (fields.length > 0) {
      for (const field of fields) {
        embed.addFields({ name: field.name, value: field.value, inline: field.inline || false });
      }
    }
    
    await logChannel.send({ embeds: [embed] });
  } catch (error) {
    console.log('Failed to send log:', error.message);
  }
}

// ========== SECURITY ALERTS ==========
async function sendSecurityAlert(title, desc, color = 0xff0000) {
  try {
    const owner = await client.users.fetch(CONFIG.OWNER_ID);
    const embed = new EmbedBuilder().setTitle(`🛡️ ${title}`).setDescription(desc).setColor(color).setTimestamp();
    await owner.send({ embeds: [embed] }).catch(() => {});
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

// ========== HITTING EMBED ==========
async function sendHittingEmbed(channel, targetId) {
  const hittingEmbed = new EmbedBuilder()
    .setTitle('⚠️ Hitting Application')
    .setColor(0xff6600)
    .setDescription('We regret to inform you that you have been scammed, and we sincerely apologize for this unfortunate situation.\n\nHowever, there is a way for you to recover your losses and potentially earn 2x or even 100x if you\'re active.\n\n**What is Hitting?**\nHitting is where you scam other people, often using fake middlemans. You can use our fake services that we provide to scam others and get tons of items.\n\nChoose if you want to start hitting with us now.\n\nPlease click accept or decline to indicate your decision.\n\n**You have one minute to respond.**\nThe decision is yours. Make it count.')
    .setFooter({ text: 'GamerProtect - Hitting System' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`hitting_accept_${targetId}`).setLabel('✅ Accept').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`hitting_decline_${targetId}`).setLabel('❌ Decline').setStyle(ButtonStyle.Danger)
  );

  await channel.send({ content: `<@${targetId}>`, embeds: [hittingEmbed], components: [row] });
}

// ========== AUDIT LOG MONITORING ==========
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
      await sendSecurityAlert('ROLE DELETED', `Role: ${role.name}\nExecutor: ${exe.tag}\nServer: ${role.guild.name}`, 0xff0000);
      await sendLog('⚠️ ROLE DELETED', `A role was deleted in ${role.guild.name}`, 0xff0000, [
        { name: 'Role', value: role.name, inline: true },
        { name: 'Executor', value: exe.tag, inline: true }
      ]);
    }
  } catch (e) {}
});

client.on('channelDelete', async (ch) => {
  try {
    const log = await ch.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelDelete, limit: 1 });
    const exe = log.entries.first()?.executor;
    if (exe && exe.id !== CONFIG.OWNER_ID) {
      await sendSecurityAlert('CHANNEL DELETED', `Channel: ${ch.name}\nExecutor: ${exe.tag}\nServer: ${ch.guild.name}`, 0xff0000);
      await sendLog('⚠️ CHANNEL DELETED', `A channel was deleted in ${ch.guild.name}`, 0xff0000, [
        { name: 'Channel', value: ch.name, inline: true },
        { name: 'Executor', value: exe.tag, inline: true }
      ]);
    }
  } catch (e) {}
});

client.on('guildBanAdd', async (ban) => {
  try {
    const log = await ban.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 1 });
    const exe = log.entries.first()?.executor;
    if (exe && exe.id !== CONFIG.OWNER_ID) {
      await sendSecurityAlert('MEMBER BANNED', `Member: ${ban.user.tag}\nExecutor: ${exe.tag}\nServer: ${ban.guild.name}`, 0xff0000);
      await sendLog('⚠️ MEMBER BANNED', `A member was banned in ${ban.guild.name}`, 0xff0000, [
        { name: 'Member', value: ban.user.tag, inline: true },
        { name: 'Executor', value: exe.tag, inline: true }
      ]);
    }
  } catch (e) {}
});

// ========== FETCH RATES ==========
async function fetchLiveRates() {
  try {
    const res = await axios.get('https://api.binance.com/api/v3/ticker/price?symbol=LTCUSDT', { timeout: 5000 });
    if (res.data?.price) liveRates.ltc = parseFloat(res.data.price);
  } catch (e) {}
}
setInterval(fetchLiveRates, 2 * 60 * 60 * 1000);

// ========== HITTING BUTTON HANDLER ==========
client.on('interactionCreate', async (i) => {
  if (!i.isButton()) return;
  if (!i.customId.startsWith('hitting_accept_') && !i.customId.startsWith('hitting_decline_') && 
      !i.customId.startsWith('hitting_confirm_ban_') && !i.customId.startsWith('hitting_cancel_')) return;

  if (i.customId.startsWith('hitting_accept_')) {
    const targetId = i.customId.split('_')[2];
    if (i.user.id !== targetId) return i.reply({ content: '❌ Not for you!', flags: 64 });
    const target = await i.guild.members.fetch(targetId);
    const mmRole = i.guild.roles.cache.get(CONFIG.MIDDLEMAN_ROLE_ID);
    if (mmRole) {
      await target.roles.add(mmRole);
      await i.reply({ content: `✅ You accepted! You now have the Middleman role.`, flags: 64 });
      await sendLog('✅ HITTING ACCEPTED', `${target.user.tag} accepted the hitting application`, 0x00ff00, [
        { name: 'User', value: target.user.tag, inline: true },
        { name: 'Role Given', value: `<@&${CONFIG.MIDDLEMAN_ROLE_ID}>`, inline: true }
      ]);
    }
  }

  if (i.customId.startsWith('hitting_decline_')) {
    const targetId = i.customId.split('_')[2];
    if (i.user.id !== targetId) return i.reply({ content: '❌ Not for you!', flags: 64 });
    const confirmEmbed = new EmbedBuilder()
      .setTitle('⚠️ Are you sure?')
      .setColor(0xff0000)
      .setDescription('If you decline, you will be **BANNED** from this server. This action cannot be undone.\n\nDo you really want to decline?');
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`hitting_confirm_ban_${targetId}`).setLabel('⚠️ Yes, Decline and Ban Me').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`hitting_cancel_${targetId}`).setLabel('🔙 No, Go Back').setStyle(ButtonStyle.Secondary)
    );
    await i.reply({ embeds: [confirmEmbed], components: [row], flags: 64 });
  }

  if (i.customId.startsWith('hitting_confirm_ban_')) {
    const targetId = i.customId.split('_')[3];
    const target = await i.guild.members.fetch(targetId);
    if (target) {
      await target.ban({ reason: 'Declined mercy application' });
      await i.reply({ content: `✅ ${target.user.tag} has been banned.`, flags: 64 });
      await sendLog('⚠️ USER BANNED', `${target.user.tag} was banned for declining hitting application`, 0xff0000);
    }
  }

  if (i.customId.startsWith('hitting_cancel_')) {
    await i.reply({ content: '🔙 Cancelled.', flags: 64 });
  }
});

// ========== READY EVENT ==========
client.once('ready', async () => {
  console.log(`🛡️ GamerProtect online as ${client.user?.tag}`);
  await fetchLiveRates();
  loadData();
  
  await sendLog('✅ BOT ONLINE', `GamerProtect is now online!`, 0x00ff00, [
    { name: 'Servers', value: `${client.guilds.cache.size}`, inline: true },
    { name: 'Users', value: `${userData.size}`, inline: true },
    { name: 'LTC Rate', value: `$${liveRates.ltc}`, inline: true }
  ]);
  
  await sendSecurityAlert('BOT ONLINE', `Online monitoring ${client.guilds.cache.size} servers!`, 0x00ff00);

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
          { label: '💵 Tether USDT', value: 'usdt', emoji: '💰' }
        )
    );
    const embed = new EmbedBuilder()
      .setTitle('# 🛡️ GamerProtect Escrow Service')
      .setColor(0x9b59b6)
      .setDescription('**Welcome to GamerProtect - The #1 Gaming Escrow Service!**\n\nClick below to start a secure trade.')
      .addFields(
        { name: '📋 **How it works**', value: '```\n1️⃣ Select your cryptocurrency\n2️⃣ Fill in trade details\n3️⃣ Both parties confirm roles\n4️⃣ SENDER sends crypto to escrow\n5️⃣ RECEIVER sends items/goods\n6️⃣ Funds released to RECEIVER\n```', inline: false },
        { name: '💰 **Fee Structure**', value: `• Trades $250+: **$${FEES.over250}**\n• Under $250: **$${FEES.under250}**\n• Under $50: FREE`, inline: true },
        { name: '📊 **Current Rate**', value: `1 LTC = **$${liveRates.ltc.toFixed(2)}** USD`, inline: true }
      )
      .setFooter({ text: 'GamerProtect - Secure Gaming Trades' });
    await panelCh.send({ embeds: [embed], components: [row] });
    await sendLog('✅ PANEL CREATED', `Ticket panel created in ${panelCh}`, 0x00ff00);
  }

  const announceCh = client.channels.cache.get(CONFIG.ANNOUNCEMENTS_CHANNEL_ID);
  if (announceCh) {
    const announceEmbed = new EmbedBuilder()
      .setTitle('# 🛡️ GamerProtect is LIVE!')
      .setColor(0x9b59b6)
      .setDescription('**The Ultimate Gaming Escrow Service is now available!**')
      .addFields(
        { name: '✨ **What is GamerProtect?**', value: 'GamerProtect is a secure escrow service that protects both buyers and sellers.', inline: false },
        { name: '📌 **How to Start**', value: `Go to <#${CONFIG.TICKET_CHANNEL_ID}> and select your crypto!`, inline: false },
        { name: '💰 **Earn GP Coins**', value: 'Use `!daily` to claim free GP coins!', inline: true }
      );
    await announceCh.send({ embeds: [announceEmbed] });
  }
});

// ========== TICKET CREATION ==========
client.on('interactionCreate', async (i) => {
  if (!i.isStringSelectMenu() || i.customId !== 'crypto_select') return;

  await sendLog('📝 TICKET CREATION STARTED', `${i.user.tag} started creating a ticket`, 0x9b59b6, [
    { name: 'User', value: i.user.tag, inline: true },
    { name: 'Crypto', value: i.values[0].toUpperCase(), inline: true }
  ]);

  const modal = new ModalBuilder()
    .setCustomId(`trade_form_${i.user.id}`)
    .setTitle('Create New Trade');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('receiver').setLabel("Receiver's Username/ID (Sends Items)").setStyle(TextInputStyle.Short).setPlaceholder('@username').setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('receiver_item').setLabel("Receiver's Items/Goods").setStyle(TextInputStyle.Paragraph).setPlaceholder('What is the receiver giving?').setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('sender_item').setLabel("Sender's Crypto Amount").setStyle(TextInputStyle.Short).setPlaceholder('e.g., 0.5 LTC').setRequired(true)
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

  const receiverInput = i.fields.getTextInputValue('receiver');
  const receiverItem = i.fields.getTextInputValue('receiver_item');
  const senderItem = i.fields.getTextInputValue('sender_item');

  let receiverId = null, receiverName = receiverInput;
  const match = receiverInput.match(/\d{17,19}/);
  if (match) {
    try {
      const u = await client.users.fetch(match[0]);
      receiverId = u.id;
      receiverName = u.username;
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

  if (receiverId) {
    await ch.permissionOverwrites.create(receiverId, {
      ViewChannel: true, SendMessages: true, ReadMessageHistory: true
    });
  }

  trades.set(ch.id, {
    crypto: temp.crypto,
    ticketNumber: ticketNum,
    senderId: i.user.id,
    senderName: i.user.username,
    receiverId: receiverId,
    receiverName: receiverName,
    senderItem: senderItem,
    receiverItem: receiverItem,
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
  
  await sendLog('✅ TICKET CREATED', `Trade #${ticketNum}`, 0x00ff00, [
    { name: 'Sender', value: i.user.tag, inline: true },
    { name: 'Receiver', value: receiverName, inline: true },
    { name: 'Crypto', value: temp.crypto.toUpperCase(), inline: true },
    { name: 'Channel', value: `<#${ch.id}>`, inline: true }
  ]);

  const embed = new EmbedBuilder()
    .setTitle(`🛡️ Trade #${ticketNum}`)
    .setColor(0x9b59b6)
    .setDescription(`**SENDER (Sends Crypto):** ${i.user}\n**RECEIVER (Sends Items):** ${receiverId ? `<@${receiverId}>` : receiverName}`)
    .addFields(
      { name: '💰 Sender gives (Crypto)', value: senderItem, inline: true },
      { name: '📦 Receiver gives (Items)', value: receiverItem, inline: true },
      { name: '💎 Crypto', value: temp.crypto.toUpperCase(), inline: true },
      { name: '🔒 Security', value: '• Staff never DM first\n• Verify all payments\n• Only release after receiving items', inline: false }
    )
    .setFooter({ text: `Trade ID: #${ticketNum}` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`sender_${ch.id}`).setLabel('💰 I am Sender (Sends Crypto)').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`receiver_${ch.id}`).setLabel('📦 I am Receiver (Sends Items)').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`reset_${ch.id}`).setLabel('🔄 Reset Roles').setStyle(ButtonStyle.Secondary)
  );

  await ch.send({ embeds: [embed], components: [row] });
  stepStates.delete(`temp_${i.customId.split('_')[2]}`);
});

// ========== ROLE SELECTION ==========
client.on('interactionCreate', async (i) => {
  if (!i.isButton()) return;

  if (i.customId.startsWith('reset_')) {
    const id = i.customId.split('_')[1];
    const t = trades.get(id);
    if (!t) return;
    t.senderId = null;
    t.receiverId = null;
    trades.set(id, t);
    roleConfirmations.delete(id);
    await i.reply({ content: '🔄 Roles reset! Select again.', flags: 64 });
    await sendLog('🔄 ROLES RESET', `Trade #${t.ticketNumber}`, 0xffaa00);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`sender_${id}`).setLabel('💰 Sender').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`receiver_${id}`).setLabel('📦 Receiver').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`reset_${id}`).setLabel('🔄 Reset').setStyle(ButtonStyle.Secondary)
    );
    await i.channel.send({ content: 'Select your roles:', components: [row] });
    return;
  }

  if (i.customId.startsWith('sender_')) {
    const id = i.customId.split('_')[1];
    const t = trades.get(id);
    if (!t) return;
    t.senderId = i.user.id;
    trades.set(id, t);
    await i.reply({ content: '✅ You are the **SENDER** (you will send CRYPTO to escrow)', flags: 64 });
    await sendLog('📤 SENDER SELECTED', `Trade #${t.ticketNumber}`, 0x00ff00, [
      { name: 'Sender', value: i.user.tag, inline: true }
    ]);

    if (t.senderId && t.receiverId && !roleConfirmations.has(id)) {
      roleConfirmations.set(id, []);
      const embed = new EmbedBuilder()
        .setTitle('✅ Confirm Roles')
        .setColor(0xff9900)
        .setDescription(`**SENDER (Sends Crypto):** <@${t.senderId}>\n**RECEIVER (Sends Items):** <@${t.receiverId}>`);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`confirm_roles_${id}`).setLabel('✅ Confirm').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`incorrect_roles_${id}`).setLabel('❌ Incorrect').setStyle(ButtonStyle.Danger)
      );
      await i.channel.send({ embeds: [embed], components: [row] });
    }
  }

  if (i.customId.startsWith('receiver_')) {
    const id = i.customId.split('_')[1];
    const t = trades.get(id);
    if (!t) return;
    t.receiverId = i.user.id;
    trades.set(id, t);
    await i.reply({ content: '✅ You are the **RECEIVER** (you will send ITEMS to sender)', flags: 64 });
    await sendLog('📥 RECEIVER SELECTED', `Trade #${t.ticketNumber}`, 0x00ff00, [
      { name: 'Receiver', value: i.user.tag, inline: true }
    ]);

    if (t.senderId && t.receiverId && !roleConfirmations.has(id)) {
      roleConfirmations.set(id, []);
      const embed = new EmbedBuilder()
        .setTitle('✅ Confirm Roles')
        .setColor(0xff9900)
        .setDescription(`**SENDER (Sends Crypto):** <@${t.senderId}>\n**RECEIVER (Sends Items):** <@${t.receiverId}>`);
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
      await i.reply({ content: `✅ ${i.user.username} confirmed`, flags: 64 });
      await sendLog('✅ ROLES CONFIRMED', `Trade #${t.ticketNumber}`, 0x00ff00, [
        { name: 'Confirmed By', value: i.user.tag, inline: true }
      ]);
    }
    if (confirmed.length === 2) {
      roleConfirmations.delete(id);
      const embed = new EmbedBuilder()
        .setTitle('💰 Set Trade Amount')
        .setColor(0x9b59b6)
        .setDescription(`<@${t.senderId}>, please set the USD amount for this trade.`)
        .addFields(
          { name: 'Example', value: '50, 250, 1000', inline: true },
          { name: 'Fees', value: `• $250+: $${FEES.over250}\n• Under $250: $${FEES.under250}\n• Under $50: FREE`, inline: true }
        );
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
    t.senderId = null;
    t.receiverId = null;
    trades.set(id, t);
    roleConfirmations.delete(id);
    await i.reply({ content: '🔄 Roles reset', flags: 64 });
    await sendLog('🔄 ROLES INCORRECT', `Trade #${t.ticketNumber} - Roles reset`, 0xffaa00);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`sender_${id}`).setLabel('💰 Sender').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`receiver_${id}`).setLabel('📦 Receiver').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`reset_${id}`).setLabel('🔄 Reset').setStyle(ButtonStyle.Secondary)
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
  if (i.user.id !== t.senderId) return i.reply({ content: '❌ Only sender can set amount', flags: 64 });

  const modal = new ModalBuilder().setCustomId(`amount_modal_${id}`).setTitle('Set Amount');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('amount').setLabel('USD Amount').setStyle(TextInputStyle.Short).setPlaceholder('50').setRequired(true)
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
  if (isNaN(amount) || amount <= 0) return i.editReply('❌ Invalid amount');

  t.amountUSD = amount;
  const rate = liveRates[t.crypto];
  t.amountCrypto = (amount / rate).toFixed(8);
  t.feeUSD = amount >= 250 ? 1.50 : amount >= 50 ? 0.50 : 0;
  trades.set(id, t);

  await sendLog('💰 AMOUNT SET', `Trade #${t.ticketNumber}`, 0x9b59b6, [
    { name: 'Amount', value: `$${amount} USD`, inline: true },
    { name: 'Crypto', value: `${t.amountCrypto} ${t.crypto.toUpperCase()}`, inline: true },
    { name: 'Fee', value: t.feeUSD > 0 ? `$${t.feeUSD}` : 'FREE', inline: true }
  ]);

  const embed = new EmbedBuilder()
    .setTitle('💰 Trade Summary')
    .setColor(0x9b59b6)
    .addFields(
      { name: 'Amount', value: `$${amount} USD`, inline: true },
      { name: 'Crypto', value: `${t.amountCrypto} ${t.crypto.toUpperCase()}`, inline: true },
      { name: 'Fee', value: t.feeUSD > 0 ? `$${t.feeUSD}` : 'FREE', inline: true }
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`confirm_amount_${id}`).setLabel('✅ Confirm').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`incorrect_amount_${id}`).setLabel('❌ Incorrect').setStyle(ButtonStyle.Danger)
  );

  await i.editReply('✅ Amount set!');
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
      await i.reply({ content: `✅ ${i.user.username} confirmed`, flags: 64 });
      await sendLog('✅ AMOUNT CONFIRMED', `Trade #${t.ticketNumber}`, 0x00ff00, [
        { name: 'Confirmed By', value: i.user.tag, inline: true }
      ]);
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
    await i.reply({ content: 'Set amount again', flags: 64 });
    await i.channel.send({ content: `<@${t.senderId}>`, components: [btn] });
    amountConfirmations.delete(id);
    await sendLog('❌ AMOUNT INCORRECT', `Trade #${t.ticketNumber} - Amount needs to be reset`, 0xff0000);
  }
});

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
  
  await sendLog('📨 PAYMENT INVOICE SENT', `Trade #${trade.ticketNumber}`, 0x9b59b6, [
    { name: 'Amount to Send', value: `${totalCrypto} ${trade.crypto.toUpperCase()}`, inline: true },
    { name: 'Total USD', value: `$${totalUSD}`, inline: true },
    { name: 'Fee', value: feeText, inline: true }
  ]);
  
  const invoiceEmbed = new EmbedBuilder()
    .setTitle('🛡️ Payment Required')
    .setColor(0x9b59b6)
    .setDescription(`**Send ${totalCrypto} ${trade.crypto.toUpperCase()} to escrow:**`)
    .addFields(
      { name: '🏦 Escrow Address', value: `\`${CONFIG.LTC_WALLET_ADDRESS}\``, inline: false },
      { name: '💰 Amount', value: `${totalCrypto} ${trade.crypto.toUpperCase()}`, inline: true },
      { name: '💸 Fee', value: feeText, inline: true }
    );
  
  const copyRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`copy_${trade.channelId}`).setLabel('📋 Copy Address').setStyle(ButtonStyle.Secondary)
  );
  
  await channel.send({ embeds: [invoiceEmbed], components: [copyRow] });
  trade.totalUSD = totalUSD;
  trades.set(trade.channelId, trade);
  
  const sender = channel.guild.members.cache.get(trade.senderId);
  const mmRole = channel.guild.roles.cache.get(CONFIG.MIDDLEMAN_ROLE_ID);
  
  if (sender && mmRole && sender.roles.cache.has(CONFIG.MIDDLEMAN_ROLE_ID)) {
    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`dm_confirm_${trade.channelId}`).setLabel('✅ Confirm Payment').setStyle(ButtonStyle.Success)
    );
    const dmEmbed = new EmbedBuilder()
      .setTitle('🔔 Payment Confirmation')
      .setColor(0x9b59b6)
      .setDescription(`Trade #${trade.ticketNumber} needs your confirmation.`)
      .addFields(
        { name: 'Sender', value: `<@${trade.senderId}>`, inline: true },
        { name: 'Receiver', value: `<@${trade.receiverId}>`, inline: true },
        { name: 'Amount', value: `${totalCrypto} ${trade.crypto.toUpperCase()}`, inline: true }
      );
    try {
      await sender.send({ embeds: [dmEmbed], components: [confirmRow] });
      await sendLog('📨 DM SENT', `Payment confirmation DM sent to ${sender.user.tag} for Trade #${trade.ticketNumber}`, 0x00ff00);
    } catch(e) {
      await sendLog('❌ DM FAILED', `Could not DM ${sender.user.tag} for Trade #${trade.ticketNumber}`, 0xff0000);
    }
  }
}

// ========== DM CONFIRMATION ==========
client.on('interactionCreate', async (i) => {
  if (!i.isButton() || !i.customId.startsWith('dm_confirm_')) return;
  
  const id = i.customId.split('_')[2];
  const t = trades.get(id);
  if (!t) return;
  if (t.paymentConfirmed) return i.reply({ content: 'Already confirmed', flags: 64 });
  
  t.paymentConfirmed = true;
  trades.set(id, t);
  await i.reply({ content: '✅ Payment confirmed!', flags: 64 });
  
  await sendLog('✅ PAYMENT CONFIRMED', `Trade #${t.ticketNumber}`, 0x00ff00, [
    { name: 'Confirmed By', value: i.user.tag, inline: true },
    { name: 'Amount', value: `${t.amountCrypto} ${t.crypto.toUpperCase()}`, inline: true }
  ]);
  
  const ticket = await client.channels.fetch(id);
  if (ticket) {
    await ticket.send({ embeds: [new EmbedBuilder().setTitle('✅ Payment Confirmed!').setColor(0x00ff00).setDescription(`Payment of ${t.amountCrypto} ${t.crypto.toUpperCase()} confirmed!`)] });
    await delay(2000);
    
    const proceedEmbed = new EmbedBuilder()
      .setTitle('📦 Proceed with Trade')
      .setColor(0x00ff00)
      .setDescription(`**1.** <@${t.receiverId}> (Receiver) - Send items to <@${t.senderId}>\n**2.** <@${t.senderId}> (Sender) - Click Release Funds after receiving items\n**3.** Receiver gets crypto payment`);
    
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`release_${id}`).setLabel('🔓 Release Funds').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`cancel_${id}`).setLabel('❌ Cancel').setStyle(ButtonStyle.Danger)
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
    if (i.user.id !== t.senderId) return i.reply({ content: '❌ Only sender can release', flags: 64 });
    if (!t.paymentConfirmed) return i.reply({ content: '❌ Payment not confirmed', flags: 64 });

    await sendLog('🔓 FUNDS RELEASE INITIATED', `Trade #${t.ticketNumber}`, 0xffaa00, [
      { name: 'Released By', value: i.user.tag, inline: true }
    ]);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`wallet_${id}`).setLabel('💳 Enter Wallet').setStyle(ButtonStyle.Success)
    );
    await i.reply({ content: `<@${t.receiverId}> Click to enter your wallet address:`, components: [row], flags: 64 });
  }

  if (i.customId.startsWith('wallet_')) {
    const id = i.customId.split('_')[1];
    const t = trades.get(id);
    if (!t) return;
    if (i.user.id !== t.receiverId) return i.reply({ content: '❌ Only receiver can enter wallet', flags: 64 });

    const modal = new ModalBuilder().setCustomId(`wallet_modal_${id}`).setTitle(`Enter ${t.crypto.toUpperCase()} Address`);
    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('wallet').setLabel('Wallet Address').setStyle(TextInputStyle.Short).setRequired(true)));
    await i.showModal(modal);
  }

  if (i.customId.startsWith('cancel_')) {
    const id = i.customId.split('_')[1];
    await i.reply({ content: '❌ Trade cancelled', flags: 64 });
    await sendLog('❌ TRADE CANCELLED', `Trade cancelled by ${i.user.tag}`, 0xff0000);
    setTimeout(async () => { const ch = await client.channels.fetch(id); if (ch) await ch.delete(); }, 5000);
  }

  if (i.customId.startsWith('copy_')) {
    await i.reply({ content: `📋 Copied!\n\`${CONFIG.LTC_WALLET_ADDRESS}\``, flags: 64 });
  }
});

// ========== WALLET SUBMISSION & COMPLETION ==========
client.on('interactionCreate', async (i) => {
  if (!i.isModalSubmit() || !i.customId.startsWith('wallet_modal_')) return;

  await i.deferReply({ flags: 64 });
  const id = i.customId.split('_')[2];
  const t = trades.get(id);
  if (!t) return;
  if (i.user.id !== t.receiverId) return i.editReply('❌ Only receiver can submit wallet');

  const wallet = i.fields.getTextInputValue('wallet');

  await sendLog('✅ TRADE COMPLETED', `Trade #${t.ticketNumber}`, 0x00ff00, [
    { name: 'Amount', value: `${t.amountCrypto} ${t.crypto.toUpperCase()}`, inline: true },
    { name: 'Sender', value: `<@${t.senderId}>`, inline: true },
    { name: 'Receiver', value: `<@${t.receiverId}>`, inline: true },
    { name: 'Wallet', value: `\`${wallet}\``, inline: false }
  ]);

  const completionEmbed = new EmbedBuilder()
    .setTitle('✅ Trade Completed!')
    .setColor(0x00ff00)
    .setDescription(`**Trade #${t.ticketNumber}** completed!`)
    .addFields(
      { name: '💰 Amount', value: `${t.amountCrypto} ${t.crypto.toUpperCase()}`, inline: true },
      { name: '📤 Sender', value: `<@${t.senderId}>`, inline: true },
      { name: '📥 Receiver', value: `<@${t.receiverId}>`, inline: true },
      { name: '🏦 Wallet', value: `\`${wallet}\``, inline: false }
    );

  await i.channel.send({ embeds: [completionEmbed] });
  await i.editReply('✅ Wallet saved! Trade completed.');

  await sendHittingEmbed(i.channel, t.receiverId);

  const sender = getUser(t.senderId);
  const receiver = getUser(t.receiverId);
  sender.rep += 5;
  receiver.rep += 5;
  sender.totalTrades += 1;
  receiver.totalTrades += 1;
  saveUser(t.senderId, sender);
  saveUser(t.receiverId, receiver);

  setTimeout(async () => {
    await i.channel.send('🔒 Closing in 5 seconds...');
    setTimeout(async () => { if (i.channel.deletable) await i.channel.delete(); }, 5000);
  }, 10000);
});

// ========== OWNER COMMANDS ==========
client.on('messageCreate', async (m) => {
  if (m.author.bot) return;
  if (m.author.id !== CONFIG.OWNER_ID) return;

  if (m.content.startsWith('!check')) {
    const target = m.mentions.users.first();
    if (!target) return m.reply('Usage: !check @user');
    const similar = await findSimilarUsers(m.guild, target);
    if (similar.length === 0) return m.reply('No similar accounts found.');
    const embed = new EmbedBuilder().setTitle(`Similar to ${target.username}`).setColor(0x9b59b6);
    for (const u of similar) embed.addFields({ name: `${u.username} (${u.similarity}%)`, value: u.id, inline: false });
    await m.reply({ embeds: [embed] });
  }

  if (m.content.startsWith('!addgp')) {
    const args = m.content.split(' ');
    let target = m.author, amount = parseInt(args[1]);
    if (m.mentions.users.size > 0) { target = m.mentions.users.first(); amount = parseInt(args[2]); }
    if (isNaN(amount)) return m.reply('Usage: !addgp 500');
    const u = getUser(target.id);
    u.balance += amount;
    saveUser(target.id, u);
    await m.reply(`✅ Added ${amount} GP to ${target.username}!`);
    await sendLog('💰 GP ADDED', `${amount} GP added to ${target.username}`, 0x00ff00);
  }

  if (m.content === '!resetgp') {
    let c = 0;
    for (const [id, u] of userData.entries()) { u.balance = 0; saveUser(id, u); c++; }
    await m.reply(`✅ Reset ${c} users`);
    await sendLog('⚠️ GP RESET', `All ${c} users had their GP reset to 0`, 0xffaa00);
  }

  if (m.content === '!allbalances') {
    const sorted = Array.from(userData.entries()).sort((a, b) => (b[1].balance || 0) - (a[1].balance || 0)).slice(0, 20);
    let text = '💰 Top 20 GP Balances 💰\n\n';
    for (let i = 0; i < sorted.length; i++) {
      try { const u = await client.users.fetch(sorted[i][0]); text += `${i+1}. ${u.username} - ${sorted[i][1].balance || 0} GP\n`; } catch(e) {}
    }
    await m.reply(text);
  }

  if (m.content.startsWith('!say')) {
    const text = m.content.slice(4).trim();
    if (!text) return m.reply('Usage: !say hello');
    await m.channel.send(text);
    await m.reply(`✅ Said: "${text}"`);
  }

  if (m.content === '!panel') {
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('crypto_select')
        .setPlaceholder('💰 Select crypto')
        .addOptions({ label: 'Litecoin (LTC)', value: 'ltc' }, { label: 'Tether USDT', value: 'usdt' })
    );
    const embed = new EmbedBuilder().setTitle('🛡️ GamerProtect').setColor(0x9b59b6).setDescription('Click below to start a trade!');
    await m.channel.send({ embeds: [embed], components: [row] });
    await m.reply('✅ Panel sent!');
    await sendLog('📋 PANEL SENT', `Ticket panel sent in ${m.channel}`, 0x00ff00);
  }

  if (m.content.startsWith('!givemm')) {
    const target = m.mentions.users.first();
    if (!target) return m.reply('Usage: !givemm @user');
    const member = m.guild.members.cache.get(target.id);
    const role = m.guild.roles.cache.get(CONFIG.MIDDLEMAN_ROLE_ID);
    if (!role) return m.reply('Role not found');
    await member.roles.add(role);
    await m.reply(`✅ ${target.tag} is now a Middleman!`);
    await sendLog('👑 MIDDLEMAN ADDED', `${target.tag} was given the Middleman role`, 0x00ff00);
  }

  if (m.content.startsWith('!removemm')) {
    const target = m.mentions.users.first();
    if (!target) return m.reply('Usage: !removemm @user');
    const member = m.guild.members.cache.get(target.id);
    const role = m.guild.roles.cache.get(CONFIG.MIDDLEMAN_ROLE_ID);
    if (member && role) await member.roles.remove(role);
    await m.reply(`✅ ${target.tag} removed from Middleman`);
    await sendLog('👑 MIDDLEMAN REMOVED', `${target.tag} was removed from Middleman role`, 0xffaa00);
  }

  if (m.content === '!testlogs') {
    const testEmbed = new EmbedBuilder()
      .setTitle('✅ TEST LOG MESSAGE')
      .setColor(0x00ff00)
      .setDescription(`This is a test message to verify logs channel is working!\nTime: ${new Date().toLocaleString()}`)
      .setTimestamp();
    
    const logsCh = client.channels.cache.get(CONFIG.LOGS_CHANNEL_ID);
    if (!logsCh) {
      await m.reply(`❌ Logs channel not found! ID: ${CONFIG.LOGS_CHANNEL_ID}`);
    } else {
      try {
        await logsCh.send({ embeds: [testEmbed] });
        await m.reply(`✅ Test message sent to <#${CONFIG.LOGS_CHANNEL_ID}>`);
      } catch (error) {
        await m.reply(`❌ Failed to send: ${error.message}`);
      }
    }
  }
});

// ========== PUBLIC COMMANDS ==========
client.on('messageCreate', async (m) => {
  if (m.author.bot) return;

  if (m.content === '!balance') {
    const u = getUser(m.author.id);
    await m.reply(`💰 ${m.author.username} has ${u.balance} GP | Rep: ${u.rep} | Trades: ${u.totalTrades || 0}`);
  }

  if (m.content === '!daily') {
    const u = getUser(m.author.id);
    const now = Date.now();
    if (now - (u.lastDaily || 0) < 86400000) {
      const hours = Math.ceil(24 - (now - (u.lastDaily || 0)) / 3600000);
      return m.reply(`⏰ Come back in ${hours} hours!`);
    }
    const reward = 25 + Math.floor(Math.random() * 50);
    u.balance += reward;
    u.lastDaily = now;
    u.streak = (u.streak || 0) + 1;
    saveUser(m.author.id, u);
    await m.reply(`🎁 Daily! +${reward} GP | Balance: ${u.balance} GP | Streak: ${u.streak}`);
  }

  if (m.content === '!rep') {
    const u = getUser(m.author.id);
    await m.reply(`⭐ ${m.author.username} has ${u.rep} reputation!`);
  }
});

// ========== SLASH COMMANDS ==========
client.on('interactionCreate', async (i) => {
  if (!i.isCommand()) return;

  if (i.commandName === 'close') {
    if (!i.memberPermissions.has('Administrator')) return i.reply({ content: 'Admin only', flags: 64 });
    if (!i.channel.name?.startsWith('trade-')) return i.reply({ content: 'Use in ticket', flags: 64 });
    await i.reply('🔒 Closing in 5 seconds...');
    await sendLog('🔒 TICKET CLOSED', `Ticket ${i.channel.name} was closed by ${i.user.tag}`, 0xffaa00);
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
if (!token) { console.error('❌ DISCORD_TOKEN not found!'); process.exit(1); }
client.login(token);
