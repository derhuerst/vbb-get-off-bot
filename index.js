'use strict'

const allStops = require('vbb-stations/full.json')
const Bot = require('node-telegram-bot-api')
const findStations = require('vbb-stations-autocomplete')
const createHafas = require('vbb-hafas')
const timezone = require('moment-timezone')
const ms = require('ms')
const createResponder = require('chatbot-coroutine')

const watchers = require('./lib/watchers')
const storage = require('./lib/storage')

const hafas = createHafas('vbb-get-off-bot')

const TOKEN = process.env.TOKEN
if (!TOKEN) {
	console.error('Missing TOKEN env var.')
	process.exit(1)
}

const TIMEZONE = process.env.TIMEZONE || 'Europe/Berlin'
const LOCALE = process.env.LOCALE || 'de-DE'

const stationsOf = Object.create(null)
for (let id in allStops) {
	stationsOf[id] = id
	for (let stop of allStops[id].stops)
	stationsOf[stop.id] = id
}

const success = `\
I will regularly watch for delays to let you know at the right time.

Keep in mind that this bot may still have bugs, so don't rely on it (yet).`

const findStation = (query) => {
	if (stationsOf[query]) return stationsOf[query]
	const s = findStations(query, 1, true, false)[0]
	if (!s || !allStops[s.id]) throw new Error(`unknown station "${query}"`)
	s.name = allStops[s.id].name
	return s
}

const findArrival = (id, name, station, cb) => () => {
	return hafas.trip(id, name)
	.then((journey) => {
		for (let stopover of journey.stopovers) {
			const st = stationsOf[stopover.stop.id]
			if (st === station.id) return stopover.arrival
		}
		return null
	})
	.then((arrival) => {
		if (!arrival) return

		const a = new Date(arrival)
		if (Number.isNaN(+a)) throw new Error(id + ' invalid arrival date: ' + arrival)

		// todo: make use of delay information
		cb(a - Date.now())
	})
	.catch((err) => {
		console.error(err)
	})
}

const renderTime = (when) => {
	return timezone(when).locale(LOCALE).tz(TIMEZONE).format('LT')
}

const renderRelative = (when) => {
	const now = Date.now()
	if (now > when) return ms(now - when) + ' ago'
	return 'in ' + ms(when - now)
}

const renderJourney = (j) => {
	const dep = new Date(j.legs[0].departure)
	const arr = new Date(j.legs[0].arrival)
	return [
		renderRelative(dep),
		ms(arr - dep) + ' travel',
		renderTime(dep) + ' – ' + renderTime(arr)
	].join(', ')
}

const conversation = function* (ctx, user) {
	let from = yield ctx.read('from')
	if (!from) {
		const query = yield ctx.prompt('Hey! Please tell me where you are.')
		from = findStation(query)
		yield ctx.send('I found ' + from.name)
		yield ctx.write('from', from)
	}

	let to = yield ctx.read('to')
	if (!to) {
		const query = yield ctx.prompt('Where do you want to go?')
		to = findStation(query)
		yield ctx.send('I found ' + to.name)
		yield ctx.write('to', to)
	}

	let journey = yield ctx.read('journey')
	if (!journey) {
		const journeys = yield hafas.journeys(from.id, to.id, {
			results: 10,
			departure: Date.now(),
			transfers: 0 // todo
		})

		for (let i = 0; i < journeys.length; i++) {
			ctx.send(i + ' – ' + renderJourney(journeys[i]))
		}

		let input = yield ctx.prompt('Which journey?')
		journey = journeys[parseInt(input)]
		while (!journey) {
			input = yield ctx.prompt('No journey found. Try again!')
			journey = journeys[parseInt(input)]
		}
		yield ctx.write('journey', journey)
	}

	// todo: support more than one part
	const id = journey.legs[0].id
	const name = journey.legs[0].line.name

	// todo: handle errors
	const watcher = findArrival(id, name, to, (timeLeft) => {
		console.info(`${id} for ${user}: ${ms(timeLeft)} left.`)
		if (timeLeft < 0) watchers.stop(user)

		if (timeLeft < 60 * 1000) {
			ctx.send(`You need to get off in ${ms(timeLeft)}.`)
		}
	})
	watchers.start(user, watcher)
	yield ctx.send(success)

	yield ctx.clear()
}

const bot = new Bot(TOKEN, {polling: true})
bot.on('message', (msg) => respond(msg.chat.id, msg.text))

const telegram = Object.assign(Object.create(bot), {
	send: bot.sendMessage.bind(bot)
})

const onError = (user, err) => {
	console.error(err)
	bot.sendMessage(user, 'oops! an error occured.')
}

const respond = createResponder(storage, telegram, conversation, onError)
