import type { Station } from '../src/index.js'
import { find as findTz } from 'geo-tz/all'
import { slugify } from './util.ts'
import countryLookup from 'country-code-lookup'
import { join, dirname } from 'path'
import { mkdir, writeFile } from 'fs/promises'
import sortObject from 'sort-object-keys'

const __dirname = new URL('.', import.meta.url).pathname
export const DATA_DIR = join(__dirname, '..', 'data')

const sortOrder: (keyof Station)[] = [
  'id',
  'name',
  'region',
  'country',
  'continent',
  'latitude',
  'longitude',
  'timezone',
  'source',
  'license',
  'disclaimers',
  'datums',
  'type',
  'harmonic_constituents',
  'offsets',
]

export function normalize(
  station: Omit<Station, 'id' | 'timezone' | 'continent'>
): Station {
  const { iso2, continent, country } =
    countryLookup.byCountry(station.country) ||
    countryLookup.byIso(station.country) ||
    {}

  if (!iso2 || !continent || !country) {
    throw new Error(
      `Unable to find country info for station: ${station.name} (${station.country})`
    )
  }

  const timezone = findTz(station.latitude, station.longitude)[0]

  if (!timezone) {
    throw new Error(
      `Unable to find timezone for station: ${station.name} (${station.latitude}, ${station.longitude})`
    )
  }

  // TODO: sort keys by order of JSON schema. Mutation for now to maintain key order
  return sortObject(
    {
      ...station,
      id: [iso2, station.region, station.name]
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
        .map(slugify)
        .join('/'),
      timezone,
      continent,
      country,
    },
    sortOrder
  )
}

export async function save(data: Station) {
  const filePath = join(DATA_DIR, `${data.id}.json`)
  const directory = dirname(filePath)

  // Create directory if it doesn't exist
  await mkdir(directory, { recursive: true })

  // Write the JSON file
  return writeFile(filePath, JSON.stringify(data, null, 2) + '\n')
}
