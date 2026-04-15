/**
 * Simple HTTP driver for Sygnal.
 *
 * Sink: stream of request objects { id, url, method?, headers?, body? }
 * Source: select(id) returns a stream of { data?, error?, status? } responses
 */
import { xs } from 'sygnal'
import type { Stream } from 'xstream'

export type HttpRequest = {
  id: string
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
}

export type HttpResponse = {
  id: string
  data: any
  status: number
  error?: string
}

export interface HttpSource {
  select(id: string): Stream<HttpResponse>
}

export function makeHttpDriver() {
  return function httpDriver(sink$: Stream<HttpRequest>): HttpSource {
    const responses: Map<string, ((resp: HttpResponse) => void)[]> = new Map()

    sink$.subscribe({
      next: (req) => {
        if (!req || !req.url) return
        fetch(req.url, {
          method: req.method || 'GET',
          headers: req.headers,
          body: req.body,
        })
          .then(async (res) => {
            let data: any
            try { data = await res.json() } catch { data = null }
            const resp: HttpResponse = { id: req.id, data, status: res.status }
            const listeners = responses.get(req.id)
            if (listeners) listeners.forEach(cb => cb(resp))
          })
          .catch((err) => {
            const resp: HttpResponse = { id: req.id, data: null, status: 0, error: err.message }
            const listeners = responses.get(req.id)
            if (listeners) listeners.forEach(cb => cb(resp))
          })
      },
      error: () => {},
      complete: () => {},
    })

    return {
      select: (id: string) => {
        return xs.create<HttpResponse>({
          start: (listener) => {
            const cb = (resp: HttpResponse) => listener.next(resp)
            if (!responses.has(id)) responses.set(id, [])
            responses.get(id)!.push(cb)
          },
          stop: () => {
            responses.delete(id)
          },
        })
      },
    }
  }
}
