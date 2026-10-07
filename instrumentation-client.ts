import { initBotId } from 'botid/client/core'

// Vercel BotID: browsers get an invisible challenge for these public endpoints; the route
// handlers reject bots with checkBotId(). Keep this list in sync with the routes that call it.
initBotId({
  protect: [
    { path: '/api/qgent/public', method: 'POST' },
    { path: '/api/leads', method: 'POST' },
  ],
})
