// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026  Pierre Jacquel
//
// This file is part of milton-browser-extension.
// See COPYING for license terms.

// Zotero schema accessor. The schema is vendored via the nested submodule
// at vendor/zotero-translate/modules/utilities/resource/schema/global/
// schema.json (BE-8-4 deviation from original Task 5.4 plan to curl
// api.zotero.org/schema — the submodule already vendors it).
//
// Helpers introspect item-type / field / creator-type definitions; some
// translators introspect schema for validation.

import schemaJson from '../../vendor/zotero-translate/modules/utilities/resource/schema/global/schema.json'

interface SchemaField {
  field: string
  baseField?: string
}

interface SchemaCreatorType {
  creatorType: string
  primary?: boolean
}

interface SchemaItemType {
  itemType: string
  fields: SchemaField[]
  creatorTypes: SchemaCreatorType[]
}

interface Schema {
  version: number
  itemTypes: SchemaItemType[]
}

const schema = schemaJson as Schema

export function getSchemaVersion(): number {
  return schema.version
}

export function getItemTypes(): string[] {
  return schema.itemTypes.map((t) => t.itemType)
}

export function getFieldsForType(itemType: string): string[] {
  const t = schema.itemTypes.find((x) => x.itemType === itemType)
  if (t === undefined) return []
  return t.fields.map((f) => f.field)
}

export function getCreatorTypesForType(itemType: string): string[] {
  const t = schema.itemTypes.find((x) => x.itemType === itemType)
  if (t === undefined) return []
  return t.creatorTypes.map((c) => c.creatorType)
}

export function getRawSchema(): unknown {
  return schema
}
