import { makeWsDriver } from '../src/drivers/ws.js'
import { makeHttpDriver } from '../src/drivers/http.js'

export default {
  WS: makeWsDriver(),
  HTTP: makeHttpDriver(),
}
