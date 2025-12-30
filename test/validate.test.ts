#!/usr/bin/env node

import { describe, test } from 'vitest'
import { readFile } from 'fs/promises'
import { join } from 'path'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { stations } from '../src/index.js'

const ROOT = new URL('..', import.meta.url).pathname
const SCHEMA_PATH = join(ROOT, 'schemas', 'station.schema.json')

const schema = JSON.parse(await readFile(SCHEMA_PATH, 'utf-8'))
const ajv = new (Ajv2020 as any)({ allErrors: true, strict: false })
;(addFormats as any)(ajv)
const validate = ajv.compile(schema)

describe('schema', () => {
  stations.forEach((station) => {
    test(`Station ${station.id}`, () => {
      const valid = validate(station)
      if (!valid)
        throw new Error(
          ajv.errorsText(validate.errors) +
            `\n${JSON.stringify(validate.errors, null, 2)}`
        )
    })
  })
})

test('Does not have duplicate stations', () => {
  const seen = new Map()
  stations.forEach((station) => {
    const dup = seen.get(station.source.id)
    if (dup) {
      throw new Error(
        `Stations ${station.id} and ${dup.id} have the same source id ${station.source.id}`
      )
    }
    seen.set(station.source.id, station)
  })
})
