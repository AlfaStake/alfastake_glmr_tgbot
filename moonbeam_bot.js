import { ApiPromise, WsProvider } from '@polkadot/api';
import { typesBundlePre900 } from "moonbeam-types-bundle"; //when using Moonbeam
import { CoinGeckoClient } from 'coingecko-api-v3';
import { Telegraf } from 'telegraf';
import axios from 'axios';
import { Low, JSONFile } from 'lowdb';

const bot = new Telegraf(TOKENBOT); // pass token bot here

const client = new CoinGeckoClient({
	timeout: 10000,
	autoRetry: true,
});

const WEI = 10 ** 18
const emojiReward = '\u{1F4B0}'
const emojiMoney = '\u{1F4B5}'
const emojichart = '\u{1F4C8}'
const emojichartdown = '\u{1F4C9}'
const emojibar = '\u{1F4CA}'
const emojipushpin = '\u{1F4CC}'
const emojirocket = '\u{1F680}'
const emojipickaxe = '\u{26CF}'
const emojilens = '\u{1F50E}'
const emojiwave = '\u{1F44B}'
const emojicry = '\u{1F622}'

// Construct
const wsProvider = new WsProvider('wss://moonbeam.api.onfinality.io/public-ws');
const api = await ApiPromise.create({ provider: wsProvider, typesBundle: typesBundlePre900 });

const indexerAPI = 'http://localhost:3000/' //put here the address of the indexer

// DATABASE USER's SETTINGS //
const adapter = new JSONFile('usersDB.json')
const db = new Low(adapter)
await db.read()
db.data ||= { users: {} }
let nominatorADDR = db.data.users 

//initialise last notifications info
let lastRound = 1
let lastNotification = 1
try {
	let query = String('query{delegationRequests(first:1, orderBy:BLOCK_NUMBER_DESC){nodes{blockNumber}}}')
	let params = new URLSearchParams([['query', query]]);
	let res = await axios.get(indexerAPI, { params });
	if (res.data.data.delegationRequests.nodes.length > 0)
		lastNotification = res.data.data.delegationRequests.nodes[0].blockNumber

	query = String('query{rounds(first:1, orderBy:START_BLOCK_DESC){nodes{id}}}')
	params = new URLSearchParams([['query', query]]);
	res = await axios.get(indexerAPI, { params });
	lastRound = res.data.data.rounds.nodes[0].id - 2

	console.log('Last round set = ' + lastRound + '\nLast notification block set = ' + lastNotification)
} catch (e) {
	console.log('Error while initialising last notifications info')
}

const ADDR = '0x' //put here the collator's address

const [chain, nodeName, nodeVersion] = await Promise.all([
	api.rpc.system.chain(),
	api.rpc.system.name(),
	api.rpc.system.version()
]);

console.log(`Connected to chain ${chain} using ${nodeName} v${nodeVersion}`);

//initialise listener to new events stored in the indexer for all chatIDs stored in the userDB
setInterval(eventListener, 30000) //run query every 30sec

// BOT COMMANDS:
bot.start((message) => {
	return message.reply('Bot is now running. Text /help to obtain the list of available commands')
})

bot.command('price', async (context) => {
	//let msg=context.update.message
	console.log('/price called')
	try {
		const pricefeed = await client.simplePrice({ ids: ['moonbeam'], vs_currencies: ['usd'] })
		const price = pricefeed['moonbeam']['usd']
		context.reply('GLMR price = ' + price + '$ ' + emojichart)

		console.log('\t... /price executed')
	} catch (e) {
		context.reply('Price feed is not currently working, try later')
		console.log('Error price feed: \n' + e)
	}
})

bot.command('rank', async (context) => {
	try {
		console.log('/rank called')
		const query = String('query{rounds(first:1, orderBy:START_BLOCK_DESC){nodes{minStakingReq}}}')
		const params = new URLSearchParams([['query', query]]);
		const res = await axios.get(indexerAPI, { params });

		const info = await api.query.parachainStaking.candidatePool();
		info.sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount));

		const idx = info.findIndex(collator => collator.owner == ADDR)
		if (idx != -1) {
			const totalStaked = info[idx].amount
			const rank = idx + 1
			context.reply('rank ' + rank + '/64. Total: ' + (totalStaked / WEI).toFixed(4) + ' GLMR staked ' + emojibar + '\n\n' + 'Minimum amount of GLMR to be an ALFASTAKE nominator: ' + (res.data.data.rounds.nodes[0].minStakingReq / WEI).toFixed(2))
		}
		else {
			context.reply('ALFASTAKE is not in the collators pool in this round')
		}

		console.log('\t... /rank executed')
	} catch (e) {
		context.reply('I\'m sorry, data feed is not available at the moment. Please retry later')
		console.log('Error when /rank: \n' + e)
	}
})

bot.command('setNominator', async (context) => {
	console.log('/setNominator called')
	const chatID = String(context.message.chat.id)
	const msg = context.update.message
	const address = msg.text.split(' ')[1]

	if (address == undefined)
		context.reply('I\'m sorry but I can\'t process your request. Please insert a valid address after the command /setNominator')
	else {
		try {
			nominatorADDR[chatID] ||= []

			if (nominatorADDR[chatID].length < 3) {
				let index = nominatorADDR[chatID].indexOf(address);
				if (index === -1) {
					nominatorADDR[chatID].push(address)

					context.reply('Address ' + nominatorADDR[chatID][nominatorADDR[chatID].length - 1] + ' has been added to the list. \n\nYou can set a maximum of 3 addresses per account.\n\nYou will be notified when new staking rewards are sent to the accounts in your watchlist and when request for delegation changes (reduction, increase or revoke) are put forward ' + emojirocket + '\n\nYou can now use the command /reward to obtain historical info about the staking rewards gained with us.\n\nYou can also use the command /showMonitoredAddresses to list the addresses you are monitoring, or use the command /unsetNominator to remove a specific address from the watchlist')

					await db.write()
				}
				else
					context.reply('Address ' + address + ' is already in your watchlist')

			}
			else {
				context.reply('I\'m sorry, you cannot add more than 3 addresses in the watchlist. Use the command /unsetNominator to remove an old address from your watchlist.')
			}

			console.log('\t... /setNominator executed')
		} catch (e) {
			context.reply('I\'m sorry, the server can\'t be reached at the moment. Please try again later.')
			console.log("Error when /setNominator:\n" + e)
		}
	}
})

bot.command('showMonitoredAddresses', async (context) => {
	console.log('/showMonitoredAddresses called')
	try {
		const chatID = String(context.message.chat.id)

		if (nominatorADDR[chatID] == undefined)
			context.reply('Your watchlist is empty. Please add new delegator addresses with /setNominator')
		else {
			const nAddr = nominatorADDR[chatID].length
			if (nAddr === 0)
				context.reply('Your watchlist is empty. Please add new delegator addresses with /setNominator')
			else {
				let text_reply = ''
				for (let i = 0; i < nAddr; i++) {
					text_reply += nominatorADDR[chatID][i]
					text_reply += '\n'
				}
				context.reply('Addresses in your watchlist:\n' + text_reply)
			}
		}

		console.log('\t... /showMonitoredAddresses executed')
	} catch (e) {
		context.reply('I\'m sorry, the server can\'t be reached at the moment. Please try again later.')
		console.log("Error when /setNominator:\n" + e)
	}
})

bot.command('unsetNominator', async (context) => {
	console.log('/unsetNominator called')
	try {
		const chatID = String(context.message.chat.id)
		const msg = context.update.message
		const address = msg.text.split(' ')[1]

		if (nominatorADDR[chatID] == undefined)
			context.reply('Your watchlist is empty. Please add new delegator addresses with /setNominator')
		else {
			let index = nominatorADDR[chatID].indexOf(address);
			if (index !== -1) {
				nominatorADDR[chatID].splice(index, 1);
				context.reply('Address ' + address + ' correctly removed from the watchlist ' + emojipushpin)
				await db.write()
			}
			else
				context.reply('Address ' + address + ' not found in the watchlist')
		}

		console.log('\t... /unsetNominator executed')
	} catch (e) {
		context.reply('I\'m sorry, the server can\'t be reached at the moment. Please try again later.')
		console.log("Error when /unsetNominator:\n" + e)
	}
})

bot.command('reward', async (context) => {
	console.log('/reward called')
	const chatID = String(context.message.chat.id)

	if (nominatorADDR[chatID] == undefined)
		context.reply('Your watchlist is empty. Please add new delegator addresses with /setNominator')
	else {
		const nAddr = nominatorADDR[chatID].length
		if (nAddr === 0)
			context.reply('Your watchlist is empty. Please add new delegator addresses with /setNominator')
		else {
			let i = 0
			let listAddr = '[\"'
			for (i = 0; i < nAddr - 1; i++)
				listAddr = listAddr.concat(nominatorADDR[chatID][i], '\", \"')
			listAddr = listAddr.concat(nominatorADDR[chatID][i], '\"]')

			try {
				const query = String('query{delegators(filter: {id: {in: ' + listAddr + '}}){nodes{id totalReward}}}')
				const params = new URLSearchParams([['query', query]]);
				const res = await axios.get(indexerAPI, { params });

				const nDelegators = res.data.data.delegators.nodes.length
				if (nDelegators == 0)
					context.reply('The addresses in your watchlist have not received any staking rewards from ALFASTAKE')
				else {
					let text_reply = ''
					for (i = 0; i < nDelegators; i++) {
						let totRew = parseInt(res.data.data.delegators.nodes[i].totalReward) / WEI
						text_reply = text_reply + 'Address ' + res.data.data.delegators.nodes[i].id + ' total staking reward obtained: ' + totRew.toFixed(4) + ' GLMR ' + emojiMoney + '\n\n'
					}
					context.reply(text_reply)
				}

				console.log('\t... /reward executed')
			} catch (e) {
				context.reply('I\'m sorry, data feed is not available at the moment. Please retry later')
				console.log('Error when /reward: \n' + e)
			}
		}
	}
})

bot.command('collatorActivity', async (context) => {
	console.log('/collatorActivity called')

	//evaluate validated blocks per round
})

bot.command('help', (context) => {
	context.reply('List of available commands:\n\n\t/price - returns the current GLMR price ' + emojichart + '\n\n\t/rank - returns ALFASTAKE current position in the collators pool ' + emojibar + '\n\n\t/collatorActivity - returns the number of validated blocks in the last round, last day and last week ' + emojipickaxe + '\n\n\t/setNominator <0xYourAddressHere> - enables to store your address in the bot preferences and to receive notification when new staking rewards are received ' + emojiMoney + '\n\n\t/reward - shows historical info about your staking rewards with ALFASTAKE ' + emojiReward + '\n\n\t/showMonitoredAddresses - shows the list of the addresses you are monitoring ' + emojilens)
})

bot.launch()

async function eventListener() {
	let addressList = []
	let userList = []
	Object.keys(nominatorADDR).forEach(user => {
		addressList.push(...nominatorADDR[user])
		for (let i = 0; i < nominatorADDR[user].length; i++)
			userList.push(user)
	})

	//send notifications here
}
