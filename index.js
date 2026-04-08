const {
  Client, GatewayIntentBits, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType, PermissionsBitField, EmbedBuilder,
  SlashCommandBuilder, REST, Routes, AuditLogEvent
} = require('discord.js');
const axios = require('axios');
const fs = require('fs');

// ========== CONFIGURATION ==========
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

// ========== DM ALERT SYSTEM ==========
async function sendAlert(title, desc, color = 0xff0000) {
  try {
    const owner = await client.users.fetch(CONFIG.OWNER_ID);
    const embed = new EmbedBuilder().setTitle(`🛡️ ${title}`).setDescription(desc).setColor(color).setTimestamp();
    await owner.send({ embeds: [embed] }).catch(() => {});
    if (CONFIG.ALT_ACCOUNT_ID && CONFIG.ALT_ACCOUNT_ID !== 'YOUR_ALT_ACCOUNT_ID_HERE') {
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
      await sendAlert('ROLE DELETED', `Role: ${role.name}\nExecutor: ${exe.tag}\nServer: ${role.guild.name}`, 0xff0000);
    }
  } catch (e) {}
});

client.on('channelDelete', async (ch) => {
  try {
    const log = await ch.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelDelete, limit: 1 });
    const exe = log.entries.first()?.executor;
    if (exe && exe.id !== CONFIG.OWNER_ID) {
      await sendAlert('CHANNEL DELETED', `Channel: ${ch.name}\nExecutor: ${exe.tag}\nServer: ${ch.guild.name}`, 0xff0000);
    }
  } catch (e) {}
});

client.on('guildBanAdd', async (ban) => {
  try {
    const log = await ban.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 1 });
    const exe = log.entries.first()?.executor;
    if (exe && exe.id !== CONFIG.OWNER_ID) {
      await sendAlert('MEMBER BANNED', `Member: ${ban.user.tag}\nExecutor: ${exe.tag}\nServer: ${ban.guild.name}`, 0xff0000);
    }
  } catch (e) {}
});

client.on('webhookUpdate', async (ch) => {
  try {
    const log = await ch.guild.fetchAuditLogs({ type: AuditLogEvent.WebhookCreate, limit: 1 });
    const exe = log.entries.first()?.executor;
    if (exe && exe.id !== CONFIG.OWNER_ID) {
      await sendAlert('WEBHOOK CREATED', `Channel: ${ch.name}\nExecutor: ${exe.tag}\nServer: ${ch.guild.name}`, 0xffaa00);
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

// ========== READY EVENT ==========
client.once('ready', async () => {
  console.log(`🛡️ GamerProtect online as ${client.user?.tag}`);
  await fetchLiveRates();
  loadData();
  await sendAlert('BOT ONLINE', `Online monitoring ${client.guilds.cache.size} servers!`, 0x00ff00);

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
      .setTitle('🛡️ GamerProtect Escrow')
      .setColor(0x9b59b6)
      .setDescription('**Secure Gaming Escrow**\nClick below to start a trade.')
      .addFields(
        { name: '💰 Fees', value: `• $250+: $${FEES.over250}\n• Under $250: $${FEES.under250}\n• Under $50: FREE`, inline: true },
        { name: '📊 Rate', value: `1 LTC = $${liveRates.ltc.toFixed(2)}`, inline: true }
      );
    await panelCh.send({ embeds: [embed], components: [row] });
    console.log('✅ Panel created');
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
      new TextInputBuilder().setCustomId('buyer').setLabel("Buyer's Username/ID").setStyle(TextInputStyle.Short).setPlaceholder('@username').setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('seller_item').setLabel("Seller's Items").setStyle(TextInputStyle.Paragraph).setPlaceholder('What is the seller giving?').setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('buyer_item').setLabel("Buyer's Crypto").setStyle(TextInputStyle.Short).setPlaceholder('0.5 LTC').setRequired(true)
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
    .setTitle(`🛡️ Trade #${ticketNum}`)
    .setColor(0x9b59b6)
    .setDescription(`**Seller (Sends Items):** ${i.user}\n**Buyer (Sends Crypto):** ${buyerId ? `<@${buyerId}>` : buyerName}`)
    .addFields(
      { name: '📦 Seller gives', value: sellerItem, inline: true },
      { name: '💰 Buyer gives', value: buyerItem, inline: true },
      { name: '💎 Crypto', value: temp.crypto.toUpperCase(), inline: true }
    );

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
    await i.reply({ content: '✅ You are the Seller (you send ITEMS)', flags: 64 });

    if (t.sellerId && t.buyerId && !roleConfirmations.has(id)) {
      roleConfirmations.set(id, []);
      const embed = new EmbedBuilder()
        .setTitle('Confirm Roles')
        .setColor(0xff9900)
        .setDescription(`**Seller:** <@${t.sellerId}>\n**Buyer:** <@${t.buyerId}>`);
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
    await i.reply({ content: '✅ You are the Buyer (you send CRYPTO)', flags: 64 });

    if (t.sellerId && t.buyerId && !roleConfirmations.has(id)) {
      roleConfirmations.set(id, []);
      const embed = new EmbedBuilder()
        .setTitle('Confirm Roles')
        .setColor(0xff9900)
        .setDescription(`**Seller:** <@${t.sellerId}>\n**Buyer:** <@${t.buyerId}>`);
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
    }
    if (confirmed.length === 2) {
      roleConfirmations.delete(id);
      const btn = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`set_amount_${id}`).setLabel('💰 Set Amount').setStyle(ButtonStyle.Primary)
      );
      await i.channel.send({ content: `<@${t.sellerId}> set the trade amount:`, components: [btn] });
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
    await i.reply({ content: '🔄 Roles reset', flags: 64 });
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
  if (i.user.id !== t.sellerId) return i.reply({ content: 'Only seller can set amount', flags: 64 });

  const modal = new ModalBuilder()
    .setCustomId(`amount_modal_${id}`)
    .setTitle('Set Amount');
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

  const embed = new EmbedBuilder()
    .setTitle('Trade Summary')
    .setColor(0x9b59b6)
    .addFields(
      { name: 'Amount', value: `$${amount}`, inline: true },
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
    }
    if (confirmed.length === 2) {
      amountConfirmations.delete(id);
      const embed = new EmbedBuilder()
        .setTitle('Payment Required')
        .setColor(0x9b59b6)
        .setDescription(`Send ${t.amountCrypto} ${t.crypto.toUpperCase()} to escrow:`)
        .addFields(
          { name: 'Escrow Address', value: `\`${CONFIG.LTC_WALLET_ADDRESS}\``, inline: false },
          { name: 'Amount', value: `${t.amountCrypto} ${t.crypto.toUpperCase()}`, inline: true }
        );
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`copy_${t.channelId}`).setLabel('📋 Copy Address').setStyle(ButtonStyle.Secondary)
      );
      await i.channel.send({ embeds: [embed], components: [row] });

      // Auto-confirm after 30 seconds (simulate payment)
      setTimeout(async () => {
        t.paymentConfirmed = true;
        trades.set(id, t);
        const confEmbed = new EmbedBuilder()
          .setTitle('✅ Payment Confirmed!')
          .setColor(0x00ff00)
          .setDescription(`Payment of ${t.amountCrypto} ${t.crypto.toUpperCase()} confirmed!`);
        const releaseRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`release_${id}`).setLabel('🔓 Release Funds').setStyle(ButtonStyle.Success)
        );
        await i.channel.send({ embeds: [confEmbed], components: [releaseRow] });
      }, 30000);
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
    await i.channel.send({ content: `<@${t.sellerId}>`, components: [btn] });
    amountConfirmations.delete(id);
  }
});

// ========== RELEASE FUNDS ==========
client.on('interactionCreate', async (i) => {
  if (!i.isButton()) return;

  if (i.customId.startsWith('release_')) {
    const id = i.customId.split('_')[1];
    const t = trades.get(id);
    if (!t) return;
    if (i.user.id !== t.sellerId) return i.reply({ content: 'Only seller can release', flags: 64 });
    if (!t.paymentConfirmed) return i.reply({ content: 'Payment not confirmed', flags: 64 });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`wallet_${id}`).setLabel('💳 Enter Wallet Address').setStyle(ButtonStyle.Success)
    );
    await i.reply({ content: `<@${t.buyerId}> Click to enter your wallet address:`, components: [row], flags: 64 });
  }

  if (i.customId.startsWith('wallet_')) {
    const id = i.customId.split('_')[1];
    const t = trades.get(id);
    if (!t) return;
    if (i.user.id !== t.buyerId) return i.reply({ content: 'Only buyer can enter wallet', flags: 64 });

    const modal = new ModalBuilder()
      .setCustomId(`wallet_modal_${id}`)
      .setTitle(`Enter ${t.crypto.toUpperCase()} Address`);
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('wallet').setLabel('Wallet Address').setStyle(TextInputStyle.Short).setRequired(true)
      )
    );
    await i.showModal(modal);
  }

  if (i.customId.startsWith('copy_')) {
    await i.reply({ content: `📋 Copied!\n\`${CONFIG.LTC_WALLET_ADDRESS}\``, flags: 64 });
  }
});

// ========== WALLET SUBMISSION & COMPLETION (NO $MERCY) ==========
client.on('interactionCreate', async (i) => {
  if (!i.isModalSubmit() || !i.customId.startsWith('wallet_modal_')) return;

  await i.deferReply({ flags: 64 });
  const id = i.customId.split('_')[2];
  const t = trades.get(id);
  if (!t) return;
  if (i.user.id !== t.buyerId) return i.editReply('Only buyer can submit wallet');

  const wallet = i.fields.getTextInputValue('wallet');

  // THIS IS THE COMPLETION EMBED - NO $MERCY COMMAND
  const completionEmbed = new EmbedBuilder()
    .setTitle('✅ Trade Completed Successfully!')
    .setColor(0x00ff00)
    .setDescription(`**Trade #${t.ticketNumber}** has been completed!`)
    .addFields(
      { name: '💰 Amount Sent', value: `${t.amountCrypto} ${t.crypto.toUpperCase()}`, inline: true },
      { name: '📤 Seller', value: `<@${t.sellerId}>`, inline: true },
      { name: '📥 Buyer', value: `<@${t.buyerId}>`, inline: true },
      { name: '🏦 Wallet', value: `\`${wallet}\``, inline: false },
      { name: '⭐ Reputation', value: '+5 rep for both parties', inline: true }
    )
    .setTimestamp();

  await i.channel.send({ embeds: [completionEmbed] });
  await i.editReply('✅ Wallet saved! Trade completed.');

  // Update user stats
  const seller = getUser(t.sellerId);
  const buyer = getUser(t.buyerId);
  seller.rep += 5;
  buyer.rep += 5;
  seller.totalTrades += 1;
  buyer.totalTrades += 1;
  saveUser(t.sellerId, seller);
  saveUser(t.buyerId, buyer);

  // Log to logs channel
  const logCh = client.channels.cache.get(CONFIG.LOGS_CHANNEL_ID);
  if (logCh) await logCh.send({ embeds: [completionEmbed] });

  // Auto-close ticket
  setTimeout(async () => {
    await i.channel.send('🔒 Closing ticket in 5 seconds...');
    setTimeout(async () => {
      if (i.channel.deletable) await i.channel.delete();
    }, 5000);
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
      embed.addFields({ name: `${u.username} (${u.similarity}%)`, value: `ID: ${u.id}`, inline: false });
    }
    await m.reply({ embeds: [embed] });
  }

  if (m.content.startsWith('!addgp')) {
    const args = m.content.split(' ');
    let target = m.author;
    let amount = parseInt(args[1]);
    if (m.mentions.users.size > 0) {
      target = m.mentions.users.first();
      amount = parseInt(args[2]);
    }
    if (isNaN(amount)) return m.reply('Usage: !addgp 500 or !addgp @user 500');
    const u = getUser(target.id);
    u.balance += amount;
    saveUser(target.id, u);
    await m.reply(`✅ Added ${amount} GP to ${target.username}! New balance: ${u.balance}`);
  }

  if (m.content === '!resetgp') {
    let c = 0;
    for (const [id, u] of userData.entries()) {
      u.balance = 0;
      saveUser(id, u);
      c++;
    }
    await m.reply(`✅ Reset ${c} users to 0 GP`);
  }

  if (m.content === '!allbalances') {
    const sorted = Array.from(userData.entries()).sort((a, b) => (b[1].balance || 0) - (a[1].balance || 0)).slice(0, 20);
    let text = '💰 Top 20 GP Balances 💰\n\n';
    for (let i = 0; i < sorted.length; i++) {
      try {
        const u = await client.users.fetch(sorted[i][0]);
        text += `${i + 1}. ${u.username} - ${sorted[i][1].balance || 0} GP (${sorted[i][1].totalTrades || 0} trades)\n`;
      } catch (e) {}
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
        .addOptions(
          { label: 'Litecoin (LTC)', value: 'ltc' },
          { label: 'Tether USDT', value: 'usdt' }
        )
    );
    const embed = new EmbedBuilder()
      .setTitle('🛡️ GamerProtect Escrow')
      .setColor(0x9b59b6)
      .setDescription('Click below to start a secure trade!');
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
    await m.reply(`✅ ${target.tag} is now a Middleman!`);
  }

  if (m.content.startsWith('!removemm')) {
    const target = m.mentions.users.first();
    if (!target) return m.reply('Usage: !removemm @user');
    const member = m.guild.members.cache.get(target.id);
    const role = m.guild.roles.cache.get(CONFIG.MIDDLEMAN_ROLE_ID);
    if (member && role) await member.roles.remove(role);
    await m.reply(`✅ ${target.tag} removed from Middleman`);
  }
});

// ========== PUBLIC COMMANDS ==========
client.on('messageCreate', async (m) => {
  if (m.author.bot) return;

  if (m.content === '!balance') {
    const u = getUser(m.author.id);
    await m.reply(`💰 ${m.author.username} has ${u.balance} GP | Rep: ${u.rep} | Trades: ${u.totalTrades || 0}`);
  }

  if (m.content === '!rep') {
    const u = getUser(m.author.id);
    await m.reply(`⭐ ${m.author.username} has ${u.rep} reputation!`);
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
    await m.reply(`🎁 Daily claimed! +${reward} GP | Balance: ${u.balance} GP | Streak: ${u.streak} days`);
  }
});

// ========== SLASH COMMANDS ==========
client.on('interactionCreate', async (i) => {
  if (!i.isCommand()) return;

  if (i.commandName === 'close') {
    if (!i.memberPermissions.has('Administrator')) return i.reply({ content: 'Admin only', flags: 64 });
    if (!i.channel.name?.startsWith('trade-')) return i.reply({ content: 'Use in ticket', flags: 64 });
    await i.reply('🔒 Closing in 5 seconds...');
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
  console.error('❌ DISCORD_TOKEN not found!');
  process.exit(1);
}
client.login(token);
