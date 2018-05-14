'use strict'

const level = require('level')
const levelDBStorage = require('chatbot-coroutine/leveldb-storage')

const DB_PATH = process.env.DB
if (!DB_PATH) {
	console.error('Missing DB env var.')
	process.exit(1)
}

const db = level(DB_PATH, {valueEncoding: 'json'})
const storage = levelDBStorage(db)

module.exports = storage
