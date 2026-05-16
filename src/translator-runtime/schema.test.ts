// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

import { describe, expect, it } from 'vitest'
import { getCreatorTypesForType, getFieldsForType, getItemTypes, getSchemaVersion } from './schema'

describe('schema accessors', () => {
  it('exposes a schema version', () => {
    expect(getSchemaVersion()).toBeGreaterThan(0)
  })

  it('lists item types including journalArticle', () => {
    const types = getItemTypes()
    expect(types).toContain('journalArticle')
    expect(types).toContain('preprint')
  })

  it('returns fields for journalArticle including title + DOI', () => {
    const fields = getFieldsForType('journalArticle')
    expect(fields).toContain('title')
    expect(fields).toContain('DOI')
  })

  it('returns empty array for unknown item type', () => {
    expect(getFieldsForType('nonexistent-type')).toEqual([])
    expect(getCreatorTypesForType('nonexistent-type')).toEqual([])
  })

  it('returns creator types for journalArticle', () => {
    const creatorTypes = getCreatorTypesForType('journalArticle')
    expect(creatorTypes.length).toBeGreaterThan(0)
    expect(creatorTypes).toContain('author')
  })
})
