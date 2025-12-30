#!/usr/bin/env node

import { writeFile } from 'fs/promises'
import createFetch from 'make-fetch-happen'
import { normalize, save } from './station.ts'
import type { Station } from '../src/index.ts'

const fetch = createFetch.defaults({
  cachePath: 'node_modules/.cache',
  cache: 'force-cache',
  retry: 10,
})

const NOAA_SOURCE_NAME = 'US National Oceanic and Atmospheric Administration'
const STATIONS_URL =
  'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json'

const idMap = new Map()

async function main() {
  console.log('Creating harmonic stations:')

  const { stations } = await fetch(
    `${STATIONS_URL}?type=tidepredictions&expand=details,tidepredoffsets&units=metric`
  ).then((r) => r.json())

  const referenceStations = stations.filter((s: any) => s.type === 'R')
  const subordinateStations = stations.filter((s: any) => s.type === 'S')

  console.log(`Fetched metadata for ${stations.length} stations.`)

  console.log('Creating reference stations:')
  for (const meta of referenceStations) {
    idMap.set(meta.id, (await saveStation(await buildStation(meta))).id)
    process.stdout.write('.')
  }

  console.log(`\nDone. Created ${referenceStations.length} reference stations.`)

  console.log('Creating subordinate stations:')

  for (const meta of subordinateStations) {
    // This should never happen, but just in case
    if (idMap.has(meta.id))
      throw new Error('Duplicate station ID found: ' + meta.id)

    // At least one station lists itself as its own reference, but doesn't have harmonic data
    if (meta.id === meta.tidepredoffsets.refStationId) continue

    idMap.set(meta.id, (await saveStation(await buildStation(meta))).id)
    process.stdout.write('.')
  }

  console.log(`\nDone. Created ${subordinateStations.length} stations.`)
}

async function saveStation(data: Station) {
  await save(data)
  return data
}

async function buildStation(meta: any): Promise<Station> {
  const station = {
    name: meta.name,
    continent: 'North America',
    country: 'United States',
    region: meta.state,
    type: meta.type == 'S' ? 'subordinate' : 'reference',
    latitude: meta.lat,
    longitude: meta.lng,
    timezone: meta.timezone,
    source: {
      name: NOAA_SOURCE_NAME,
      id: meta.id,
      published_harmonics: true,
      url: `https://tidesandcurrents.noaa.gov/stationhome.html?id=${meta.id}`,
    },
    license: {
      type: 'public domain',
      commercial_use: true,
      url: 'https://tidesandcurrents.noaa.gov/disclaimers.html',
    },
  }

  if (meta.type == 'S') {
    const refId = idMap.get(meta.tidepredoffsets.refStationId)
    if (!refId) {
      throw new Error(
        `Reference station ID ${meta.tidepredoffsets.refStationId} not found for subordinate station ${meta.id}`
      )
    }

    Object.assign(station, {
      offsets: {
        reference: refId,
        height: {
          type:
            meta.tidepredoffsets.heightAdjustedType === 'R' ? 'ratio' : 'fixed',
          high: meta.tidepredoffsets.heightOffsetHighTide,
          low: meta.tidepredoffsets.heightOffsetLowTide,
        },
        time: {
          high: meta.tidepredoffsets.timeOffsetHighTide,
          low: meta.tidepredoffsets.timeOffsetLowTide,
        },
      },
    })
  } else {
    // Fetch full station details
    const res = await fetch(
      `https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/${meta.id}.json?expand=details,datums,harcon,disclaimers,notices&units=metric`
    ).then((r) => r.json())
    const data = res.stations[0]

    // This should never happen, but just in case
    if (!data) throw new Error(`No data found for station ID: ${meta.id}`)

    // Write raw data to tmp for debugging
    writeFile(`tmp/noaa/${meta.id}.json`, JSON.stringify(data, null, 2))

    Object.assign(station, {
      harmonic_constituents: data.harmonicConstituents.HarmonicConstituents.map(
        (h: any) => ({
          name: h.name,
          description: h.description,
          amplitude: h.amplitude,
          phase_UTC: h.phase_GMT,
          phase_local: h.phase_local,
          speed: h.speed,
          // TODO: add comments
        })
      ),
      datums: {
        ...(data.datums.LAT ? { LAT: data.datums.LAT } : {}),
        ...(data.datums.HAT ? { HAT: data.datums.HAT } : {}),
        // Some stations don't have all datums
        ...(data.datums.datums
          ? Object.fromEntries(
              data.datums.datums.map((d: any) => [d.name, d.value])
            )
          : {}),
      },
      disclaimers: (data.disclaimers.disclaimers ?? [])
        .map((d: any) => d.text)
        .join('\n'),
    })
  }

  return normalize(station as Station)
}

main().catch(console.error)
