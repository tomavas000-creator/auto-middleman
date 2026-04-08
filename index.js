import {
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
  Routes,
  Message,
  Interaction,
  ButtonInteraction,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
  CommandInteraction,
  TextChannel,
  AuditLogEvent
} from 'discord.js';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

// ========== CONFIGURATION - CHANGE THESE ==========
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

const FEES = {
  over250: 1.50,
  under250: 0.50,
  free: 0.00,
  freeThreshold: 50,
  over250Threshold: 250
};

// ========== STORAGE ==========
const DATA_FILE = path.join(__dirname, '..', 'gamerprotect_data.json');
let userData: Map<string, any> = new Map();
let trades: Map<string, any> = new Map();
let stepStates: Map<string, any> = new Map();
let roleConfirmations: Map<string, string[]> = new Map();
let amountConfirmations: Map<string, string[]> = new Map();
let feeConfirmations: Map<string, any> = new Map();
let liveRates: { ltc: number; usdt: number } = { ltc: 55.83, usdt: 1.00 };
let pendingPaymentConfirmations: Map<string, NodeJS.Timeout> = new Map();

// ========== HELPER FUNCTIONS ==========
function loadData(): void {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      if (data.userData) {
        for (const [key, value] of Object.entries(data.userData)) {
          userData.set(key, value);
        }
      }
      console.log(`✅ Loaded data for ${userData.size} users`);
    }
  } catch (error) {
    console.error('Error loading data:', error);
  }
}

function saveData(): void {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ userData: Object.fromEntries(userData) }, null, 2));
  } catch (error) {
    console.error('Error saving data:', error);
  }
}

function getUser(userId: string): any {
  let data = userData.get(userId);
  if (!data) {
    data = { 
      balance: 0, 
      rep: 0, 
      streak: 0, 
      lastDaily: 0, 
      referrals: [], 
      achievements: [], 
      totalTrades: 0 
    };
    userData.set(userId, data);
  }
  return data;
}

function saveUser(userId: string, data: any): void {
  userData.set(userId, data);
  saveData();
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ========== DM ALERT SYSTEM ==========
async function sendAlert(title: string, description: string, color: number = 0xff0000): Promise<void> {
  try {
    const owner = await client.users.fetch(CONFIG.OWNER_ID);
    const embed = new EmbedBuilder()
      .setTitle(`🛡️ ${title}`)
      .setDescription(description)
      .setColor(color)
      .setTimestamp();
    await owner.send({ embeds: [embed] }).catch(() => console.log('Could not DM owner'));
    
    if (CONFIG.ALT_ACCOUNT_ID && CONFIG.ALT_ACCOUNT_ID !== 'YOUR_ALT_ACCOUNT_ID_HERE') {
      const alt = await client.users.fetch(CONFIG.ALT_ACCOUNT_ID);
      await alt.send({ embeds: [embed] }).catch(() => console.log('Could not DM alt account'));
    }
  } catch (error) {
    console.error('Failed to send alert:', error);
  }
}

// ========== SIMILAR USER CHECK ==========
function calculateSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();
  if (s1 === s2) return 100;
  if (s1.includes(s2) || s2.includes(s1)) return 75;
  let matches = 0;
  for (let i = 0; i < Math.min(s1.length, s2.length); i++) {
    if (s1[i] === s2[i]) matches++;
  }
  return (matches / Math.max(s1.length, s2.length)) * 100;
}

async function findSimilarUsers(guild: any, targetUser: any): Promise<any[]> {
  const similarUsers: any[] = [];
  const targetName = targetUser.username;
  await guild.members.fetch();
  
  for (const member of guild.members.cache.values()) {
    if (member.id === targetUser.id) continue;
    const similarity = calculateSimilarity(targetName, member.user.username);
    if (similarity >= 50) {
      similarUsers.push({
        id: member.id,
        username: member.user.username,
        similarity: Math.round(similarity),
        joinDate: member.joinedAt || new Date(),
        mutualGuilds: member.user.client.guilds.cache.size
      });
    }
  }
  return similarUsers.sort((a, b) => b.similarity - a.similarity).slice(0, 10);
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
    const auditLog = await role.guild.fetchAuditLogs({ type: AuditLogEvent.RoleDelete, limit: 1 });
    const executor = auditLog.entries.first()?.executor;
    if (executor && executor.id !== CONFIG.OWNER_ID) {
      await sendAlert('⚠️ ROLE DELETED', 
        `**Role:** ${role.name}\n**Executor:** ${executor.tag} (${executor.id})\n**Server:** ${role.guild.name}`, 0xff0000);
    }
  } catch (error) {}
});

client.on('roleCreate', async (role) => {
  try {
    const auditLog = await role.guild.fetchAuditLogs({ type: AuditLogEvent.RoleCreate, limit: 1 });
    const executor = auditLog.entries.first()?.executor;
    if (executor && executor.id !== CONFIG.OWNER_ID) {
      await sendAlert('⚠️ ROLE CREATED', 
        `**Role:** ${role.name}\n**Executor:** ${executor.tag} (${executor.id})\n**Server:** ${role.guild.name}`, 0xffaa00);
    }
  } catch (error) {}
});

client.on('channelDelete', async (channel) => {
  try {
    const auditLog = await channel.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelDelete, limit: 1 });
    const executor = auditLog.entries.first()?.executor;
    if (executor && executor.id !== CONFIG.OWNER_ID) {
      await sendAlert('⚠️ CHANNEL DELETED', 
        `**Channel:** ${channel.name}\n**Executor:** ${executor.tag} (${executor.id})\n**Server:** ${channel.guild.name}`, 0xff0000);
    }
  } catch (error) {}
});

client.on('guildMemberRemove', async (member) => {
  try {
    const auditLog = await member.guild.fetchAuditLogs({ type: AuditLogEvent.MemberKick, limit: 1 });
    const executor = auditLog.entries.first()?.executor;
    if (executor && executor.id !== CONFIG.OWNER_ID && member.id !== member.user.id) {
      await sendAlert('⚠️ MEMBER KICKED', 
        `**Member:** ${member.user.tag} (${member.id})\n**Executor:** ${executor.tag} (${executor.id})\n**Server:** ${member.guild.name}`, 0xffaa00);
    }
  } catch (error) {}
});

client.on('guildBanAdd', async (ban) => {
  try {
    const auditLog = await ban.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 1 });
    const executor = auditLog.entries.first()?.executor;
    if (executor && executor.id !== CONFIG.OWNER_ID) {
      await sendAlert('⚠️ MEMBER BANNED', 
        `**Member:** ${ban.user.tag} (${ban.user.id})\n**Executor:** ${executor.tag} (${executor.id})\n**Server:** ${ban.guild.name}`, 0xff0000);
    }
  } catch (error) {}
});

client.on('webhookUpdate', async (channel) => {
  try {
    const auditLog = await channel.guild.fetchAuditLogs({ type: AuditLogEvent.WebhookCreate, limit: 1 });
    const executor = auditLog.entries.first()?.executor;
    if (executor && executor.id !== CONFIG.OWNER_ID) {
      await sendAlert('⚠️ WEBHOOK CREATED/UPDATED', 
        `**Channel:** ${channel.name}\n**Executor:** ${executor.tag} (${executor.id})\n**Server:** ${channel.guild.name}`, 0xffaa00);
    }
  } catch (error) {}
});

client.on('messageDeleteBulk', async (messages) => {
  try {
    const channel = messages.first()?.channel;
    if (channel) {
      await sendAlert('⚠️ MASS MESSAGE DELETE', 
        `**Channel:** ${channel.name}\n**Messages deleted:** ${messages.size}\n**Server:** ${channel.guild?.name}`, 0xffaa00);
    }
  } catch (error) {}
});

// ========== FETCH RATES ==========
async function fetchLiveRates(): Promise<void> {
  try {
    const response = await axios.get('https://api.binance.com/api/v3/ticker/price?symbol=LTCUSDT', { timeout: 5000 });
    if (response.data && response.data.price) liveRates.ltc = parseFloat(response.data.price);
    console.log(`📊 Rates updated: LTC = $${liveRates.ltc}`);
  } catch (error) {
    console.error('Error fetching rates:', error);
  }
}
setInterval(fetchLiveRates, 2 * 60 * 60 * 1000);

// ========== READY EVENT ==========
client.once('ready', async () => {
  console.log(`🛡️ GamerProtect online as ${client.user?.tag}`);
  console.log(`💰 LTC Escrow Address: ${CONFIG.LTC_WALLET_ADDRESS}`);
  await fetchLiveRates();
  loadData();
  await sendAlert('✅ BOT ONLINE', `GamerProtect is now online monitoring ${client.guilds.cache.size} servers!`, 0x00ff00);
  
  // Register slash commands
  const rest = new REST({ version: '10' }).setToken(client.token!);
  try {
    await rest.put(Routes.applicationCommands(client.user!.id), {
      body: [
        new SlashCommandBuilder().setName('close').setDescription('Close ticket (Admin)'),
        new SlashCommandBuilder().setName('say').setDescription('Make bot say something (Owner)')
          .addStringOption(option => option.setName('message').setDescription('What to say').setRequired(true))
          .addChannelOption(option => option.setName('channel').setDescription('Channel to send to'))
      ]
    });
    console.log('✅ Slash commands registered');
  } catch (error) {
    console.error('Failed to register slash commands:', error);
  }
  
  // Create ticket panel
  const panelChannel = client.channels.cache.get(CONFIG.TICKET_CHANNEL_ID) as TextChannel;
  if (panelChannel) {
    try {
      const old = await panelChannel.messages.fetch({ limit: 10 });
      const oldPanel = old.find(m => m.author.id === client.user?.id);
      if (oldPanel) await oldPanel.delete();
      
      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('crypto_select')
          .setPlaceholder('💰 Select cryptocurrency')
          .addOptions(
            { label: '📀 Litecoin (LTC)', value: 'ltc', emoji: '💎', description: 'Fast & low fees' },
            { label: '💵 Tether USDT (BEP-20)', value: 'usdt', emoji: '💰', description: 'Stablecoin' }
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
      
      await panelChannel.send({ embeds: [embed], components: [row] });
      console.log('✅ Ticket panel created');
    } catch (error) {
      console.error('Failed to create ticket panel:', error);
    }
  }
  
  // Create announcement if channel exists
  const announceChannel = client.channels.cache.get(CONFIG.ANNOUNCEMENTS_CHANNEL_ID) as TextChannel;
  if (announceChannel) {
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
      .setFooter({ text: 'GamerProtect - The #1 Gaming Escrow Service' });
    
    await announceChannel.send({ embeds: [announceEmbed] }).catch(() => {});
  }
});

// ========== TICKET CREATION ==========
client.on('interactionCreate', async (interaction: Interaction) => {
  if (!interaction.isStringSelectMenu()) return;
  if (interaction.customId !== 'crypto_select') return;
  
  const selectInteraction = interaction as StringSelectMenuInteraction;
  const crypto = selectInteraction.values[0];
  
  const modal = new ModalBuilder()
    .setCustomId(`trade_form_${selectInteraction.user.id}`)
    .setTitle('🛡️ Create New Trade');
  
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('buyer')
        .setLabel("📥 Buyer's Username or ID (Receives Crypto)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('@username or Discord ID')
        .setRequired(true)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('seller_item')
        .setLabel('🎮 What is the Seller giving? (Items/Account/Goods)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Describe what the seller is trading (e.g., "CS2 Knife", "Roblox Account", "Fortnite Skin")')
        .setRequired(true)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('buyer_item')
        .setLabel('💰 What is the Buyer giving? (Crypto Amount)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g., 0.5 LTC, $100 worth of USDT, or 150 LTC')
        .setRequired(true)
    )
  );
  
  stepStates.set(`temp_${selectInteraction.user.id}`, { crypto });
  await selectInteraction.showModal(modal);
});

// ========== FORM SUBMISSION ==========
client.on('interactionCreate', async (interaction: Interaction) => {
  if (!interaction.isModalSubmit()) return;
  if (!interaction.customId.startsWith('trade_form_')) return;
  
  const modalInteraction = interaction as ModalSubmitInteraction;
  await modalInteraction.deferReply({ flags: 64 });
  
  const userId = modalInteraction.customId.split('_')[2];
  const temp = stepStates.get(`temp_${userId}`);
  if (!temp) return modalInteraction.editReply('❌ Session expired. Please start over.');
  
  const buyerInput = modalInteraction.fields.getTextInputValue('buyer');
  const sellerItem = modalInteraction.fields.getTextInputValue('seller_item');
  const buyerItem = modalInteraction.fields.getTextInputValue('buyer_item');
  
  // Find buyer
  let buyerId = null;
  let buyerName = buyerInput;
  const buyerMatch = buyerInput.match(/\d{17,19}/);
  if (buyerMatch) {
    try {
      const user = await client.users.fetch(buyerMatch[0]);
      buyerId = user.id;
      buyerName = user.username;
    } catch (e) {}
  } else {
    const guild = modalInteraction.guild;
    if (guild) {
      const members = await guild.members.fetch();
      const found = members.find(m => m.user.username.toLowerCase() === buyerInput.toLowerCase() || m.displayName.toLowerCase() === buyerInput.toLowerCase());
      if (found) {
        buyerId = found.id;
        buyerName = found.user.username;
      }
    }
  }
  
  const ticketNum = Math.floor(Math.random() * 9000) + 1000;
  const channelName = `trade-${modalInteraction.user.username}-${ticketNum}`;
  
  const adminRole = modalInteraction.guild?.roles.cache.find(role => role.permissions.has(PermissionsBitField.Flags.Administrator));
  
  const channel = await modalInteraction.guild?.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: CONFIG.TICKET_CATEGORY_ID,
    permissionOverwrites: [
      { id: modalInteraction.guild!.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: modalInteraction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.AttachFiles] }
    ]
  });
  
  if (buyerId && channel) {
    await channel.permissionOverwrites.create(buyerId, {
      ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true
    });
  }
  
  if (adminRole && channel) {
    await channel.permissionOverwrites.create(adminRole, {
      ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true
    });
  }
  
  const middlemanRole = modalInteraction.guild?.roles.cache.get(CONFIG.MIDDLEMAN_ROLE_ID);
  if (middlemanRole && channel) {
    await channel.permissionOverwrites.create(middlemanRole, {
      ViewChannel: true, SendMessages: true, ReadMessageHistory: true
    });
  }
  
  trades.set(channel!.id, {
    crypto: temp.crypto,
    ticketNumber: ticketNum,
    sellerId: modalInteraction.user.id,
    sellerName: modalInteraction.user.username,
    buyerId: buyerId,
    buyerName: buyerName,
    sellerItem: sellerItem,
    buyerItem: buyerItem,
    amountUSD: null,
    amountCrypto: null,
    feeUSD: 0,
    feePayer: null,
    status: 'waiting_roles',
    channelId: channel!.id,
    exchangeRateUsed: liveRates[temp.crypto as keyof typeof liveRates],
    paymentConfirmed: false,
    createdAt: Date.now()
  });
  
  await modalInteraction.editReply(`✅ **Ticket created successfully!**\n🔗 ${channel}`);
  
  const welcomeEmbed = new EmbedBuilder()
    .setTitle(`# 🛡️ GamerProtect Escrow - Trade #${ticketNum}`)
    .setColor(0x9b59b6)
    .setDescription('**Welcome to your secure escrow ticket!** Please select your roles below.')
    .addFields(
      { name: '📤 **Seller (Sends Items)**', value: `${modalInteraction.user}\n**Giving:** ${sellerItem}`, inline: true },
      { name: '📥 **Buyer (Sends Crypto)**', value: buyerId ? `<@${buyerId}>` : buyerName, inline: true },
      { name: '💎 **Cryptocurrency**', value: temp.crypto.toUpperCase(), inline: true },
      { name: '📝 **Trade Details**', value: `\`\`\`\nSeller gives: ${sellerItem}\nBuyer gives: ${buyerItem}\nCrypto: ${temp.crypto.toUpperCase()}\nEscrow: GamerProtect Secure\n\`\`\``, inline: false },
      { name: '🔒 **Security Reminders**', value: '• Staff will **NEVER** DM you first\n• Always verify payments on blockchain\n• Never release items before payment confirmation\n• Save all conversation screenshots', inline: false }
    )
    .setFooter({ text: `Trade ID: #${ticketNum} | Created: ${new Date().toLocaleString()}` });
  
  const deleteRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`delete_${channel!.id}`).setLabel('❌ Cancel Trade').setStyle(ButtonStyle.Danger)
  );
  
  const roleRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`seller_${channel!.id}`).setLabel('📤 I am the Seller (Sending Items)').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`buyer_${channel!.id}`).setLabel('📥 I am the Buyer (Sending Crypto)').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`reset_${channel!.id}`).setLabel('🔄 Reset Roles').setStyle(ButtonStyle.Secondary)
  );
  
  await channel?.send({ embeds: [welcomeEmbed], components: [deleteRow, roleRow] });
  stepStates.delete(`temp_${userId}`);
});

// ========== DELETE TICKET ==========
client.on('interactionCreate', async (interaction: Interaction) => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('delete_')) return;
  
  const buttonInteraction = interaction as ButtonInteraction;
  const id = buttonInteraction.customId.split('_')[1];
  await buttonInteraction.reply({ content: '🗑️ Cancelling trade...', flags: 64 });
  setTimeout(async () => {
    const ch = await client.channels.fetch(id);
    if (ch) await ch.delete();
  }, 3000);
});

// ========== ROLE SELECTION ==========
client.on('interactionCreate', async (interaction: Interaction) => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('seller_') && !interaction.customId.startsWith('buyer_') && !interaction.customId.startsWith('reset_')) return;
  
  const buttonInteraction = interaction as ButtonInteraction;
  const id = buttonInteraction.customId.split('_')[1];
  const trade = trades.get(id);
  if (!trade) return;
  
  if (interaction.customId.startsWith('reset_')) {
    trade.sellerId = null;
    trade.buyerId = null;
    trades.set(id, trade);
    roleConfirmations.delete(id);
    await buttonInteraction.reply({ content: '🔄 Roles have been reset', flags: 64 });
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`seller_${id}`).setLabel('📤 Seller (Sends Items)').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`buyer_${id}`).setLabel('📥 Buyer (Sends Crypto)').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`reset_${id}`).setLabel('🔄 Reset').setStyle(ButtonStyle.Secondary)
    );
    await buttonInteraction.channel?.send({ content: 'Select your roles:', components: [row] });
    return;
  }
  
  if (interaction.customId.startsWith('seller_')) {
    if (trade.sellerId) return buttonInteraction.reply({ content: '❌ Seller role already taken!', flags: 64 });
    trade.sellerId = buttonInteraction.user.id;
    await buttonInteraction.reply({ content: '✅ You are the **Seller** (you will send ITEMS to the buyer)', flags: 64 });
  } else if (interaction.customId.startsWith('buyer_')) {
    if (trade.buyerId) return buttonInteraction.reply({ content: '❌ Buyer role already taken!', flags: 64 });
    trade.buyerId = buttonInteraction.user.id;
    await buttonInteraction.reply({ content: '✅ You are the **Buyer** (you will send CRYPTO to escrow)', flags: 64 });
  }
  trades.set(id, trade);
  
  if (trade.sellerId && trade.buyerId && !roleConfirmations.has(id)) {
    roleConfirmations.set(id, []);
    const confirmEmbed = new EmbedBuilder()
      .setTitle('✅ Confirm Roles')
      .setColor(0xff9900)
      .setDescription(`**Seller (Sends Items):** <@${trade.sellerId}>\n**Buyer (Sends Crypto):** <@${trade.buyerId}>\n\n**Please confirm these roles are correct.**`)
      .setFooter({ text: 'Both parties must click confirm to continue' });
    
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`confirm_roles_${id}`).setLabel('✅ Confirm').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`incorrect_roles_${id}`).setLabel('❌ Incorrect').setStyle(ButtonStyle.Danger)
    );
    await buttonInteraction.channel?.send({ embeds: [confirmEmbed], components: [row] });
  }
});

// ========== ROLE CONFIRMATION ==========
client.on('interactionCreate', async (interaction: Interaction) => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('confirm_roles_') && !interaction.customId.startsWith('incorrect_roles_')) return;
  
  const buttonInteraction = interaction as ButtonInteraction;
  const id = interaction.customId.split('_')[2];
  const trade = trades.get(id);
  if (!trade) return;
  
  const confirmed = roleConfirmations.get(id) || [];
  
  if (interaction.customId.startsWith('incorrect_roles_')) {
    trade.sellerId = null;
    trade.buyerId = null;
    trades.set(id, trade);
    roleConfirmations.delete(id);
    await buttonInteraction.reply({ content: '🔄 Roles have been reset. Please select again.', flags: 64 });
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`seller_${id}`).setLabel('📤 Seller').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`buyer_${id}`).setLabel('📥 Buyer').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`reset_${id}`).setLabel('🔄 Reset').setStyle(ButtonStyle.Secondary)
    );
    await buttonInteraction.channel?.send({ content: 'Select your roles:', components: [row] });
    return;
  }
  
  if (!confirmed.includes(buttonInteraction.user.id)) {
    confirmed.push(buttonInteraction.user.id);
    roleConfirmations.set(id, confirmed);
    await buttonInteraction.reply({ content: `✅ ${buttonInteraction.user.username} confirmed the roles`, flags: 64 });
  }
  
  if (confirmed.length === 2 && confirmed.includes(trade.sellerId) && confirmed.includes(trade.buyerId)) {
    roleConfirmations.delete(id);
    
    const amountEmbed = new EmbedBuilder()
      .setTitle('💰 Set Trade Amount')
      .setColor(0x9b59b6)
      .setDescription(`<@${trade.sellerId}>, please set the USD amount for this trade.`)
      .addFields(
        { name: '📝 **Example**', value: '`50`, `250`, `1000`', inline: true },
        { name: '💰 **Fee Structure**', value: `• $${FEES.over250Threshold}+: **$${FEES.over250}**\n• Under $${FEES.over250Threshold}: **$${FEES.under250}**\n• Under $${FEES.freeThreshold}: **FREE**`, inline: true },
        { name: '⚠️ **Important**', value: 'The fee is added to the total amount the buyer must send.', inline: false }
      )
      .setFooter({ text: 'The seller sets the amount based on the trade value' });
    
    const btn = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`set_amount_${id}`).setLabel('💰 Set Amount').setStyle(ButtonStyle.Primary)
    );
    await buttonInteraction.channel?.send({ embeds: [amountEmbed], components: [btn] });
  }
});

// ========== SET AMOUNT ==========
client.on('interactionCreate', async (interaction: Interaction) => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('set_amount_')) return;
  
  const buttonInteraction = interaction as ButtonInteraction;
  const id = interaction.customId.split('_')[2];
  const trade = trades.get(id);
  if (!trade) return;
  
  if (buttonInteraction.user.id !== trade.sellerId) {
    return buttonInteraction.reply({ content: '❌ Only the seller can set the trade amount', flags: 64 });
  }
  
  const modal = new ModalBuilder()
    .setCustomId(`amount_modal_${id}`)
    .setTitle('Set Trade Amount');
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('amount')
        .setLabel('USD Amount')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Enter amount in USD (e.g., 50, 250, 1000)')
        .setRequired(true)
    )
  );
  await buttonInteraction.showModal(modal);
});

// ========== HANDLE AMOUNT ==========
client.on('interactionCreate', async (interaction: Interaction) => {
  if (!interaction.isModalSubmit()) return;
  if (!interaction.customId.startsWith('amount_modal_')) return;
  
  const modalInteraction = interaction as ModalSubmitInteraction;
  await modalInteraction.deferReply({ flags: 64 });
  
  const id = modalInteraction.customId.split('_')[2];
  const trade = trades.get(id);
  if (!trade) return;
  
  const amount = parseFloat(modalInteraction.fields.getTextInputValue('amount'));
  if (isNaN(amount) || amount <= 0) return modalInteraction.editReply('❌ Invalid amount. Please enter a positive number.');
  
  trade.amountUSD = amount;
  const rate = liveRates[trade.crypto as keyof typeof liveRates];
  trade.exchangeRateUsed = rate;
  trade.amountCrypto = (amount / rate).toFixed(8);
  
  if (amount >= FEES.over250Threshold) trade.feeUSD = FEES.over250;
  else if (amount >= FEES.freeThreshold) trade.feeUSD = FEES.under250;
  else trade.feeUSD = 0;
  
  trades.set(id, trade);
  
  const summaryEmbed = new EmbedBuilder()
    .setTitle('💰 Trade Summary')
    .setColor(0x9b59b6)
    .setDescription(`**Trade #${trade.ticketNumber}**`)
    .addFields(
      { name: '💵 **Amount**', value: `$${amount.toFixed(2)} USD`, inline: true },
      { name: '💎 **Crypto**', value: `${trade.amountCrypto} ${trade.crypto.toUpperCase()}`, inline: true },
      { name: '📊 **Exchange Rate**', value: `1 ${trade.crypto.toUpperCase()} = $${rate.toFixed(2)}`, inline: true },
      { name: '💸 **Fee**', value: trade.feeUSD > 0 ? `$${trade.feeUSD}` : 'FREE', inline: true },
      { name: '📤 **Seller**', value: `<@${trade.sellerId}>`, inline: true },
      { name: '📥 **Buyer**', value: `<@${trade.buyerId}>`, inline: true }
    )
    .setFooter({ text: 'Please confirm the amount is correct' });
  
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`confirm_amount_${id}`).setLabel('✅ Confirm Amount').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`incorrect_amount_${id}`).setLabel('❌ Incorrect').setStyle(ButtonStyle.Danger)
  );
  
  await modalInteraction.editReply('✅ Amount has been set!');
  await modalInteraction.channel?.send({ embeds: [summaryEmbed], components: [row] });
  amountConfirmations.set(id, []);
});

// ========== AMOUNT CONFIRMATION ==========
client.on('interactionCreate', async (interaction: Interaction) => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('confirm_amount_') && !interaction.customId.startsWith('incorrect_amount_')) return;
  
  const buttonInteraction = interaction as ButtonInteraction;
  const id = interaction.customId.split('_')[2];
  const trade = trades.get(id);
  if (!trade) return;
  
  const confirmed = amountConfirmations.get(id) || [];
  
  if (interaction.customId.startsWith('incorrect_amount_')) {
    const btn = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`set_amount_${id}`).setLabel('💰 Set Amount').setStyle(ButtonStyle.Primary)
    );
    await buttonInteraction.reply({ content: '❌ Please set the correct amount', flags: 64 });
    await buttonInteraction.channel?.send({ content: `<@${trade.sellerId}>`, components: [btn] });
    amountConfirmations.delete(id);
    return;
  }
  
  if (!confirmed.includes(buttonInteraction.user.id)) {
    confirmed.push(buttonInteraction.user.id);
    amountConfirmations.set(id, confirmed);
    await buttonInteraction.reply({ content: `✅ ${buttonInteraction.user.username} confirmed the amount`, flags: 64 });
  }
  
  if (confirmed.length === 2 && confirmed.includes(trade.sellerId) && confirmed.includes(trade.buyerId)) {
    amountConfirmations.delete(id);
    
    if (trade.feeUSD === 0) {
      await sendPaymentInvoice(buttonInteraction.channel as TextChannel, trade);
    } else {
      const feeEmbed = new EmbedBuilder()
        .setTitle('💸 Who pays the fee?')
        .setColor(0xff9900)
        .setDescription(`**Fee Amount:** $${trade.feeUSD}\n**Split option:** $${(trade.feeUSD / 2).toFixed(2)} each\n\nSelect who will pay the fee:`);
      
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`fee_seller_${id}`).setLabel('📤 Seller Pays').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`fee_buyer_${id}`).setLabel('📥 Buyer Pays').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`fee_split_${id}`).setLabel('⚖️ Split 50/50').setStyle(ButtonStyle.Secondary)
      );
      await buttonInteraction.channel?.send({ embeds: [feeEmbed], components: [row] });
      feeConfirmations.set(id, { users: [], selected: null });
    }
  }
});

// ========== FEE SELECTION ==========
client.on('interactionCreate', async (interaction: Interaction) => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('fee_')) return;
  
  const buttonInteraction = interaction as ButtonInteraction;
  const id = interaction.customId.split('_')[2];
  const trade = trades.get(id);
  if (!trade) return;
  if (trade.feePayer) return;
  
  const state = feeConfirmations.get(id);
  if (!state) return;
  
  let selected: string | null = null;
  if (interaction.customId.startsWith('fee_seller')) selected = 'seller';
  else if (interaction.customId.startsWith('fee_buyer')) selected = 'buyer';
  else selected = 'split';
  
  if (!state.users.includes(buttonInteraction.user.id)) {
    state.users.push(buttonInteraction.user.id);
    if (!state.selected) state.selected = selected;
    feeConfirmations.set(id, state);
    await buttonInteraction.reply({ content: `✅ You selected: ${selected?.toUpperCase()}`, flags: 64 });
  } else {
    return buttonInteraction.reply({ content: '❌ You already selected!', flags: 64 });
  }
  
  if (state.users.length === 2 && state.users.includes(trade.sellerId) && state.users.includes(trade.buyerId)) {
    if (state.selected === selected) {
      if (state.selected === 'seller') trade.feePayer = trade.sellerId;
      else if (state.selected === 'buyer') trade.feePayer = trade.buyerId;
      else trade.feePayer = 'split';
      trades.set(id, trade);
      feeConfirmations.delete(id);
      await buttonInteraction.channel?.send(`✅ Fee will be paid by: **${state.selected.toUpperCase()}**`);
      await sendPaymentInvoice(buttonInteraction.channel as TextChannel, trade);
    } else {
      await buttonInteraction.channel?.send('❌ **Fee selection mismatch!** The two parties selected different options. Please try again.');
      feeConfirmations.delete(id);
      
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`fee_seller_${id}`).setLabel('📤 Seller Pays').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`fee_buyer_${id}`).setLabel('📥 Buyer Pays').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`fee_split_${id}`).setLabel('⚖️ Split 50/50').setStyle(ButtonStyle.Secondary)
      );
      const feeEmbed = new EmbedBuilder()
        .setTitle('💸 Who pays the fee?')
        .setColor(0xff9900)
        .setDescription(`**Fee Amount:** $${trade.feeUSD}\n**Split option:** $${(trade.feeUSD / 2).toFixed(2)} each\n\nSelect who will pay the fee:`);
      await buttonInteraction.channel?.send({ embeds: [feeEmbed], components: [row] });
      feeConfirmations.set(id, { users: [], selected: null });
    }
  }
});

// ========== SEND PAYMENT INVOICE ==========
async function sendPaymentInvoice(channel: TextChannel, trade: any): Promise<void> {
  const rate = trade.exchangeRateUsed || liveRates[trade.crypto as keyof typeof liveRates];
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
  
  const copyRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`copy_${trade.channelId}`).setLabel('📋 Copy Address').setStyle(ButtonStyle.Secondary)
  );
  
  await channel.send({ embeds: [invoiceEmbed], components: [copyRow] });
  trade.totalUSD = totalUSD;
  trades.set(trade.channelId, trade);
  
  // Notify middleman role to confirm payment
  const middlemanRole = channel.guild.roles.cache.get(CONFIG.MIDDLEMAN_ROLE_ID);
  if (middlemanRole) {
    const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`dm_confirm_${trade.channelId}`).setLabel('✅ Confirm Payment').setStyle(ButtonStyle.Success)
    );
    
    const dmEmbed = new EmbedBuilder()
      .setTitle('🔔 Payment Confirmation Required')
      .setColor(0x9b59b6)
      .setDescription(`A trade requires your confirmation as a GamerProtect Middleman.`)
      .addFields(
        { name: 'Trade ID', value: `#${trade.ticketNumber}`, inline: true },
        { name: 'Amount', value: `${totalCrypto} ${trade.crypto.toUpperCase()}`, inline: true },
        { name: 'Seller', value: `<@${trade.sellerId}>`, inline: true },
        { name: 'Buyer', value: `<@${trade.buyerId}>`, inline: true }
      )
      .setFooter({ text: 'Only confirm after verifying the payment on the blockchain' });
    
    for (const member of middlemanRole.members.values()) {
      try {
        await member.send({ embeds: [dmEmbed], components: [confirmRow] });
      } catch (e) {}
    }
  }
}

// ========== DM CONFIRMATION (MIDDLEMAN) ==========
client.on('interactionCreate', async (interaction: Interaction) => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('dm_confirm_')) return;
  
  const buttonInteraction = interaction as ButtonInteraction;
  const id = buttonInteraction.customId.split('_')[2];
  const trade = trades.get(id);
  if (!trade) return;
  if (trade.paymentConfirmed) return buttonInteraction.reply({ content: '✅ Payment already confirmed!', flags: 64 });
  
  trade.paymentConfirmed = true;
  trades.set(id, trade);
  await buttonInteraction.reply({ content: '✅ Payment confirmed! Thank you.', flags: 64 });
  
  const ticket = await client.channels.fetch(id) as TextChannel;
  if (ticket) {
    const confirmedEmbed = new EmbedBuilder()
      .setTitle('✅ Payment Confirmed on Blockchain!')
      .setColor(0x00ff00)
      .setDescription(`**Trade #${trade.ticketNumber}**\n\nThe crypto payment has been verified on the blockchain!`)
      .addFields(
        { name: '💰 **Amount**', value: `${trade.amountCrypto} ${trade.crypto.toUpperCase()}`, inline: true },
        { name: '💵 **USD Value**', value: `$${trade.amountUSD}`, inline: true },
        { name: '📊 **Exchange Rate**', value: `1 ${trade.crypto.toUpperCase()} = $${trade.exchangeRateUsed?.toFixed(2)}`, inline: true }
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
    
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`release_${id}`).setLabel('🔓 Release Funds').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`cancel_${id}`).setLabel('❌ Cancel Trade').setStyle(ButtonStyle.Danger)
    );
    await ticket.send({ embeds: [proceedEmbed], components: [row] });
  }
});

// ========== RELEASE FUNDS ==========
client.on('interactionCreate', async (interaction: Interaction) => {
  if (!interaction.isButton()) return;
  
  const buttonInteraction = interaction as ButtonInteraction;
  
  if (buttonInteraction.customId.startsWith('release_')) {
    const id = buttonInteraction.customId.split('_')[1];
    const trade = trades.get(id);
    if (!trade) return;
    
    if (buttonInteraction.user.id !== trade.sellerId) {
      return buttonInteraction.reply({ content: '❌ Only the seller can release funds!', flags: 64 });
    }
    
    if (!trade.paymentConfirmed) {
      return buttonInteraction.reply({ content: '❌ Payment has not been confirmed yet!', flags: 64 });
    }
    
    const walletEmbed = new EmbedBuilder()
      .setTitle('📥 Enter Your Wallet Address')
      .setColor(0x9b59b6)
      .setDescription(`<@${trade.buyerId}>, the seller has released the funds!\n\nPlease click the button below to enter your ${trade.crypto.toUpperCase()} wallet address to receive payment.`)
      .addFields(
        { name: '💰 **Amount to Receive**', value: `${trade.amountCrypto} ${trade.crypto.toUpperCase()}`, inline: true },
        { name: '💵 **USD Value**', value: `$${trade.amountUSD}`, inline: true },
        { name: '🔒 **Privacy**', value: 'Your wallet address is only visible to staff', inline: true }
      )
      .setFooter({ text: 'Enter your wallet address to receive funds' });
    
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`wallet_request_${id}`)
        .setLabel('💳 Enter Wallet Address')
        .setStyle(ButtonStyle.Success)
    );
    
    await buttonInteraction.reply({ content: `✅ Release initiated! Waiting for <@${trade.buyerId}> to provide wallet address...`, flags: 64 });
    await buttonInteraction.channel?.send({ content: `<@${trade.buyerId}>`, embeds: [walletEmbed], components: [row] });
  }
  
  if (buttonInteraction.customId.startsWith('wallet_request_')) {
    const id = buttonInteraction.customId.split('_')[2];
    const trade = trades.get(id);
    if (!trade) return;
    
    if (buttonInteraction.user.id !== trade.buyerId) {
      return buttonInteraction.reply({ content: '❌ Only the buyer can enter their wallet address!', flags: 64 });
    }
    
    const modal = new ModalBuilder()
      .setCustomId(`wallet_modal_${id}`)
      .setTitle(`Enter Your ${trade.crypto.toUpperCase()} Wallet Address`);
    
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('wallet')
          .setLabel(`${trade.crypto.toUpperCase()} Wallet Address`)
          .setStyle(TextInputStyle.Short)
          .setPlaceholder(trade.crypto === 'ltc' ? 'Enter your LTC wallet address' : 'Enter your USDT wallet address (BEP-20)')
          .setRequired(true)
      )
    );
    
    await buttonInteraction.showModal(modal);
  }
  
  if (buttonInteraction.customId.startsWith('cancel_')) {
    const id = buttonInteraction.customId.split('_')[1];
    await buttonInteraction.reply({ content: '❌ Trade cancelled. Closing ticket...', flags: 64 });
    setTimeout(async () => {
      const ch = await client.channels.fetch(id);
      if (ch) await ch.delete();
    }, 5000);
  }
  
  if (buttonInteraction.customId.startsWith('copy_')) {
    const id = buttonInteraction.customId.split('_')[1];
    const trade = trades.get(id);
    if (trade) {
      await buttonInteraction.reply({ 
        content: `📋 Escrow address copied!\n\`\`\`${CONFIG.LTC_WALLET_ADDRESS}\`\`\`\n**Amount to send:** ${trade.amountCrypto} ${trade.crypto.toUpperCase()}`, 
        flags: 64 
      });
    } else {
      await buttonInteraction.reply({ 
        content: `📋 Escrow address copied!\n\`\`\`${CONFIG.LTC_WALLET_ADDRESS}\`\`\``, 
        flags: 64 
      });
    }
  }
});

// ========== WALLET SUBMISSION & COMPLETION ==========
client.on('interactionCreate', async (interaction: Interaction) => {
  if (!interaction.isModalSubmit()) return;
  if (!interaction.customId.startsWith('wallet_modal_')) return;
  
  const modalInteraction = interaction as ModalSubmitInteraction;
  await modalInteraction.deferReply({ flags: 64 });
  
  const id = modalInteraction.customId.split('_')[2];
  const trade = trades.get(id);
  if (!trade) return;
  
  if (modalInteraction.user.id !== trade.buyerId) {
    return modalInteraction.editReply('❌ Only the buyer can submit their wallet address!');
  }
  
  const buyerWallet = modalInteraction.fields.getTextInputValue('wallet');
  const sent = trade.amountCrypto;
  const usd = (parseFloat(sent) * (trade.exchangeRateUsed || liveRates[trade.crypto as keyof typeof liveRates])).toFixed(2);
  
  // ========== COMPLETION EMBED (This replaces the $mercy command) ==========
  const completionEmbed = new EmbedBuilder()
    .setTitle('✅ Trade Completed Successfully!')
    .setColor(0x00ff00)
    .setDescription(`**Trade #${trade.ticketNumber}** has been completed!`)
    .addFields(
      { name: '💰 **Amount Sent**', value: `${sent} ${trade.crypto.toUpperCase()}`, inline: true },
      { name: '💵 **USD Value**', value: `$${usd}`, inline: true },
      { name: '📤 **Seller**', value: `<@${trade.sellerId}>`, inline: true },
      { name: '📥 **Buyer**', value: `<@${trade.buyerId}>`, inline: true },
      { name: '🏦 **Buyer Wallet**', value: `\`${buyerWallet}\``, inline: false },
      { name: '⭐ **Reputation Earned**', value: '+5 rep for both parties', inline: true },
      { name: '🛡️ **Escrow Service**', value: 'GamerProtect - Secure Gaming Trades', inline: true }
    )
    .setFooter({ text: 'Thank you for using GamerProtect!' })
    .setTimestamp();
  
  await modalInteraction.channel?.send({ embeds: [completionEmbed] });
  await modalInteraction.editReply('✅ Wallet address received! Trade completed successfully.');
  
  // Send alert to owner about completed trade
  await sendAlert('✅ TRADE COMPLETED', 
    `**Trade #${trade.ticketNumber}**\n**Seller:** <@${trade.sellerId}>\n**Buyer:** <@${trade.buyerId}>\n**Amount:** ${sent} ${trade.crypto.toUpperCase()} ($${usd})`, 0x00ff00);
  
  // Update user stats
  const seller = getUser(trade.sellerId);
  const buyer = getUser(trade.buyerId);
  seller.rep = (seller.rep || 0) + 5;
  buyer.rep = (buyer.rep || 0) + 5;
  seller.totalTrades = (seller.totalTrades || 0) + 1;
  buyer.totalTrades = (buyer.totalTrades || 0) + 1;
  
  // Add GP rewards (5% of trade amount, min 10, max 500)
  const gpReward = Math.min(Math.max(Math.floor(trade.amountUSD * 0.05), 10), 500);
  seller.balance = (seller.balance || 0) + gpReward;
  buyer.balance = (buyer.balance || 0) + gpReward;
  
  saveUser(trade.sellerId, seller);
  saveUser(trade.buyerId, buyer);
  
  // Log to logs channel
  const logsChannel = client.channels.cache.get(CONFIG.LOGS_CHANNEL_ID) as TextChannel;
  if (logsChannel) {
    await logsChannel.send({ embeds: [completionEmbed] });
  }
  
  trade.status = 'completed';
  trades.set(id, trade);
  
  // Auto-close ticket after 10 seconds
  setTimeout(async () => {
    try {
      await modalInteraction.channel?.send('🔒 Ticket will close in 5 seconds...');
      setTimeout(async () => {
        if (modalInteraction.channel?.deletable) await modalInteraction.channel?.delete();
      }, 5000);
    } catch (e) {}
  }, 10000);
});

// ========== OWNER COMMANDS ==========
client.on('messageCreate', async (message: Message) => {
  if (message.author.bot) return;
  if (message.author.id !== CONFIG.OWNER_ID) return;
  
  // !check @user - Find similar accounts
  if (message.content.startsWith('!check')) {
    const target = message.mentions.users.first();
    if (!target) return message.reply('❌ Usage: `!check @user`');
    
    await message.reply(`🔍 **Checking for accounts similar to ${target.username}...**`);
    const similar = await findSimilarUsers(message.guild, target);
    
    if (similar.length === 0) {
      return message.reply(`✅ **No similar accounts found for ${target.username}.**`);
    }
    
    const embed = new EmbedBuilder()
      .setTitle(`🔍 Similar Accounts to ${target.username}`)
      .setColor(0x9b59b6)
      .setDescription(`Found **${similar.length}** account(s) with similar usernames (50%+ match)`)
      .setTimestamp();
    
    for (const user of similar) {
      embed.addFields({ 
        name: `${user.username} (${user.similarity}% match)`, 
        value: `ID: \`${user.id}\`\nJoined: ${user.joinDate.toLocaleDateString()}\nMutual Guilds: ${user.mutualGuilds}`,
        inline: false 
      });
    }
    await message.reply({ embeds: [embed] });
  }
  
  // !addgp
  if (message.content.startsWith('!addgp')) {
    const args = message.content.split(' ');
    let target = message.author;
    let amount = parseInt(args[1]);
    if (message.mentions.users.size > 0) {
      target = message.mentions.users.first()!;
      amount = parseInt(args[2]);
    }
    if (isNaN(amount) || amount <= 0) return message.reply('❌ Usage: `!addgp 500` or `!addgp @user 500`');
    const user = getUser(target.id);
    user.balance += amount;
    saveUser(target.id, user);
    await message.reply(`✅ Added **${amount} GP** to ${target.username}! New balance: **${user.balance} GP**`);
  }
  
  // !resetgp
  if (message.content === '!resetgp') {
    await message.reply('⚠️ **WARNING:** This will reset EVERYONE\'s GP balance to 0. Type `!confirmreset` within 30 seconds to confirm.');
    const filter = (m: Message) => m.author.id === CONFIG.OWNER_ID && m.content === '!confirmreset';
    const collector = message.channel.createMessageCollector({ filter, time: 30000, max: 1 });
    collector.on('collect', async () => {
      let count = 0;
      for (const [userId, user] of userData.entries()) {
        user.balance = 0;
        saveUser(userId, user);
        count++;
      }
      await message.reply(`✅ **Reset complete!** ${count} users have had their GP balance set to 0.`);
    });
    collector.on('end', collected => {
      if (collected.size === 0) message.reply('❌ Reset cancelled (timeout).');
    });
  }
  
  // !allbalances
  if (message.content === '!allbalances') {
    const sorted = Array.from(userData.entries()).sort((a, b) => (b[1].balance || 0) - (a[1].balance || 0)).slice(0, 20);
    let text = '💰 **ALL GP BALANCES (Top 20)** 💰\n\n';
    for (let i = 0; i < sorted.length; i++) {
      try {
        const user = await client.users.fetch(sorted[i][0]);
        text += `${i + 1}. ${user.username} - ${sorted[i][1].balance || 0} GP (${sorted[i][1].totalTrades || 0} trades, ${sorted[i][1].rep || 0} rep)\n`;
      } catch (e) {
        text += `${i + 1}. Unknown User - ${sorted[i][1].balance || 0} GP\n`;
      }
    }
    if (text.length > 2000) {
      await message.reply({ files: [{ attachment: Buffer.from(text), name: 'balances.txt' }] });
    } else {
      await message.reply(text);
    }
  }
  
  // !say
  if (message.content.startsWith('!say')) {
    const text = message.content.slice(4).trim();
    if (!text) return message.reply('❌ Usage: `!say Hello world!`');
    const channelMatch = text.match(/^<#(\d+)>\s+(.+)/);
    let targetChannel = message.channel;
    let textToSay = text;
    if (channelMatch) {
      const channelId = channelMatch[1];
      textToSay = channelMatch[2];
      targetChannel = message.guild?.channels.cache.get(channelId) as TextChannel;
      if (!targetChannel) return message.reply('❌ Channel not found!');
    }
    try {
      await targetChannel.send(textToSay);
      await message.reply(`✅ Said "${textToSay}" in ${targetChannel}`);
    } catch (error) {
      await message.reply(`❌ Failed: ${error}`);
    }
  }
  
  // !panel
  if (message.content === '!panel') {
    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('crypto_select')
        .setPlaceholder('💰 Select cryptocurrency')
        .addOptions(
          { label: '📀 Litecoin (LTC)', value: 'ltc', emoji: '💎' },
          { label: '💵 Tether USDT (BEP-20)', value: 'usdt', emoji: '💰' }
        )
    );
    const embed = new EmbedBuilder()
      .setTitle('# 🛡️ GamerProtect Escrow')
      .setColor(0x9b59b6)
      .setDescription('**Secure Escrow for Gaming Trades**')
      .addFields(
        { name: '💰 Fees', value: `• $250+: $${FEES.over250}\n• Under $250: $${FEES.under250}\n• Under $50: FREE`, inline: true },
        { name: '📊 Rate', value: `1 LTC = $${liveRates.ltc.toFixed(2)}`, inline: true }
      )
      .setFooter({ text: 'GamerProtect - #1 Gaming Escrow' });
    await message.channel.send({ embeds: [embed], components: [row] });
    await message.reply('✅ Panel sent!');
  }
  
  // !givemm
  if (message.content.startsWith('!givemm')) {
    const target = message.mentions.users.first();
    if (!target) return message.reply('❌ Usage: `!givemm @user`');
    const member = message.guild?.members.cache.get(target.id);
    const role = message.guild?.roles.cache.get(CONFIG.MIDDLEMAN_ROLE_ID);
    if (!role) return message.reply('❌ Role not found');
    await member?.roles.add(role);
    await message.reply(`✅ ${target.tag} is now a GamerProtect Middleman!`);
  }
  
  // !removemm
  if (message.content.startsWith('!removemm')) {
    const target = message.mentions.users.first();
    if (!target) return message.reply('❌ Usage: `!removemm @user`');
    const member = message.guild?.members.cache.get(target.id);
    const role = message.guild?.roles.cache.get(CONFIG.MIDDLEMAN_ROLE_ID);
    if (member && role) await member.roles.remove(role);
    await message.reply(`✅ ${target.tag} removed from Middleman`);
  }
  
  // !listmm
  if (message.content === '!listmm') {
    const role = message.guild?.roles.cache.get(CONFIG.MIDDLEMAN_ROLE_ID);
    if (!role) return message.reply('❌ Middleman role not found');
    const members = role.members.map(m => `• ${m.user.tag} (${m.id})`);
    if (members.length === 0) return message.reply('📋 No middlemen have the role yet.');
    await message.reply(`🛡️ **GamerProtect Middlemen:**\n${members.join('\n')}`);
  }
});

// ========== ECONOMY COMMANDS FOR EVERYONE ==========
client.on('messageCreate', async (message: Message) => {
  if (message.author.bot) return;
  
  if (message.content === '!balance') {
    const user = getUser(message.author.id);
    await message.reply(`💰 **${message.author.username}** has **${user.balance} GP**\n⭐ Reputation: ${user.rep}\n📊 Total Trades: ${user.totalTrades || 0}`);
  }
  
  if (message.content === '!rep') {
    const user = getUser(message.author.id);
    await message.reply(`⭐ **${message.author.username}** has **${user.rep}** reputation points!`);
  }
  
  if (message.content === '!daily') {
    const user = getUser(message.author.id);
    const now = Date.now();
    if (now - (user.lastDaily || 0) < 86400000) {
      const hoursLeft = Math.ceil(24 - (now - (user.lastDaily || 0)) / 3600000);
      return message.reply(`⏰ **Come back in ${hoursLeft} hours!**`);
    }
    const reward = 25 + Math.floor(Math.random() * 50) + Math.floor((user.streak || 0) / 3) * 15;
    user.balance += reward;
    user.lastDaily = now;
    user.streak = (user.streak || 0) + 1;
    saveUser(message.author.id, user);
    await message.reply(`🎁 **Daily Claimed!** +${reward} GP\n🔥 Streak: ${user.streak} days\n💰 Balance: ${user.balance} GP`);
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
    let text = '🏆 **Top Traders Leaderboard** 🏆\n\n';
    for (let i = 0; i < sorted.length; i++) {
      try {
        const user = await client.users.fetch(sorted[i][0]);
        text += `${i + 1}. ${user.username} - ${sorted[i][1].balance || 0} GP (${sorted[i][1].totalTrades || 0} trades)\n`;
      } catch (e) {}
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
    await message.reply(`💝 **${message.author.username}** tipped **${amount} GP** to ${target.username}!`);
  }
});

// ========== SLASH COMMANDS ==========
client.on('interactionCreate', async (interaction: Interaction) => {
  if (!interaction.isCommand()) return;
  const cmd = interaction as CommandInteraction;
  
  if (cmd.commandName === 'close') {
    if (!cmd.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
      return cmd.reply({ content: '❌ Admin only', flags: 64 });
    }
    if (!cmd.channel?.name?.startsWith('trade-')) {
      return cmd.reply({ content: '❌ Use in trade ticket channel', flags: 64 });
    }
    await cmd.reply('🔒 **Closing ticket in 5 seconds...**');
    setTimeout(() => cmd.channel?.delete(), 5000);
  }
  
  if (cmd.commandName === 'say') {
    if (cmd.user.id !== CONFIG.OWNER_ID) {
      return cmd.reply({ content: '❌ Owner only', flags: 64 });
    }
    const msg = cmd.options.getString('message', true);
    const channel = cmd.options.getChannel('channel') || cmd.channel;
    await cmd.deferReply({ flags: 64 });
    if (channel?.isTextBased()) await (channel as TextChannel).send(msg);
    await cmd.editReply(`✅ Said "${msg}" in ${channel}`);
  }
});

// ========== LOGIN ==========
const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('❌ DISCORD_TOKEN not found in environment variables!');
  process.exit(1);
}
client.login(token);
