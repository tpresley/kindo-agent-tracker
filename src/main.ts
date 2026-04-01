import { run, makeServiceWorkerDriver } from 'sygnal'
import { makeKindoDriver } from './drivers/kindoApi'
import App from './App'
import './style.css'

run(App, {
  SW: makeServiceWorkerDriver('/sw.js'),
  KINDO: makeKindoDriver(),
})
