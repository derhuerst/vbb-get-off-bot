'use strict'

const allStops = require('vbb-stations/full.json')
const Bot = require('node-telegram-bot-api')
const vbb = require('vbb-client')
const lines = require('vbb-lines')

const TOKEN = process.env.TOKEN
if (!TOKEN) {
	console.error('Missing TOKEN env var.')
	process.exit(1)
}

const stationsOf = {}
for (let id in allStops) {
	stationsOf[id] = id
	for (let stop of allStops[id].stops)
	stationsOf[stop.id] = id
}

const findVariants = (from, to) => {
	const variants = []

	return new Promise((yay, nay) => {
		lines('all')
		.once('error', yay)
		.on('data', (line) => {
			const variant = line.variants.find((v) => {
				for (let i = 0; i < (v.length - 1); v++) {
					const id = stationsOf[v[i]]
					if (id !== from) continue

					for (let j = i + 1; j < v.length; j++) {
						const id2 = stationsOf[v[j]]
						if (id2 === to) return true
					}
				}
				return false
			})
			if (variant) variants.push([variant, line])
		})
		.on('end', () => yay(variants))
	})
}

const bot = new Bot(TOKEN, {polling: true})
const data = {}

bot.on('message', (msg) => {
	const user = msg.chat.id
	const text = msg.text
	if (!data[user]) data[user] = {state: 0}
	const d = data[user]

	if (d.state === 0) {
		bot.sendMessage(user, 'Hey! Please tell me where you are.')
		d.state = 1
	} else if (d.state === 1) {
		vbb.stations({
			query: text, results: 1,
			identifier: 'https://github.com/derhuerst/vbb-get-off-bot'
		})
		.then((stations) => {
			bot.sendMessage(user, 'I found ' + stations[0].name)
			d.from = stations[0].id

			d.state = 2
			bot.sendMessage(user, 'Where do you want to go?')
		})
		.catch((err) => {
			bot.sendMessage(user, 'Oops!' + (err.message || err))
		})
	} else if (d.state === 2) {
		vbb.stations({
			query: text, results: 1,
			identifier: 'https://github.com/derhuerst/vbb-get-off-bot'
		})
		.then((stations) => {
			bot.sendMessage(user, 'I found ' + stations[0].name)
			d.to = stations[0].id

			return findVariants(d.from, d.to)
		})
		.then((results) => {
			d.results = results
			bot.sendMessage(user, 'Which line?')
			// for (let [variant, line] of results) {
			for (let i = 0; i < results.length; i++) {
				bot.sendMessage(user, i + ' – ' + results[i][1].name)
			}
			d.state = 3
		})
		.catch((err) => {
			bot.sendMessage(user, 'Oops!' + (err.message || err))
		})
	} else if (d.state === 3) {
		const result = d.results[parseInt(text)]
		if (!result) return bot.sendMessage('Oops! No line found.')

		const [variant, line] = result
		// bot.sendMessage(user, line.id + ' – ' + line.name)

		d.state = 0
	}
})
