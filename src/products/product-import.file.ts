import {
  BadRequestException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { extname } from 'node:path';
import { TextDecoder } from 'node:util';
import {
  ImportFormat,
  MAX_IMPORT_BYTES,
  MAX_PRODUCTS,
} from './product-import.parser';
import { readImportXml, XmlElement } from './product-import.xml';
import { MAX_IMPORT_COLUMNS, readImportWorkbook } from './product-import.xlsx';

const {
  parse,
}: {
  parse: (
    text: string,
    options: {
      delimiter: string;
      skip_empty_lines: true;
      trim: true;
      to?: number;
      on_record?: (record: string[]) => string[];
    },
  ) => string[][];
} = require('csv-parse/sync');

const googleNamespace = 'http://base.google.com/ns/1.0';
type Row = Record<string, string | string[]>;
type ImportRows = { format: ImportFormat; products: Row[] };

export async function readProductImportFile(
  file: Express.Multer.File,
  query: { dryRun?: unknown; format?: unknown; locale?: unknown },
) {
  const { dryRun, format, locale } = query;
  if (dryRun !== undefined && dryRun !== 'true' && dryRun !== 'false') {
    throw new BadRequestException('dryRun must be true or false');
  }
  const mode = dryRun === undefined ? {} : { dryRun: dryRun === 'true' };
  const extension = extname(file.originalname).toLowerCase();
  if (extension === '.json') {
    let json: unknown;
    try {
      json = JSON.parse(utf8(file.buffer));
    } catch {
      throw new BadRequestException('File must contain valid UTF-8 JSON');
    }
    return json && typeof json === 'object' && !Array.isArray(json)
      ? { ...json, ...mode }
      : json;
  }

  let rows: ImportRows;
  switch (extension) {
    case '.csv':
    case '.tsv':
      rows = tableRows(readDelimited(utf8(file.buffer), extension === '.tsv'));
      break;
    case '.xlsx':
      rows = tableRows(await readImportWorkbook(file.buffer));
      break;
    case '.xml':
      rows = readFeed(utf8(file.buffer));
      break;
    default:
      throw new UnsupportedMediaTypeException(
        'Upload a .xlsx, .csv, .tsv, .xml or .json file',
      );
  }
  return {
    ...rows,
    format: format === undefined || format === 'auto' ? rows.format : format,
    locale,
    ...mode,
  };
}

function utf8(buffer: Buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new BadRequestException('Text files must use UTF-8 encoding');
  }
}

function readDelimited(text: string, tsv: boolean) {
  const options = { skip_empty_lines: true, trim: true } as const;
  let delimiter = tsv ? '\t' : ',';
  if (!tsv) {
    let width = 0;
    for (const candidate of [',', ';', '\t']) {
      try {
        const [header] = parse(text, {
          ...options,
          delimiter: candidate,
          to: 1,
        });
        if (header?.length > width) {
          delimiter = candidate;
          width = header.length;
        }
      } catch {
        // A quoted header can be invalid when read with the wrong delimiter.
      }
    }
  }
  try {
    let records = 0;
    return parse(text, {
      ...options,
      delimiter,
      on_record: (row) => {
        if (row.length > MAX_IMPORT_COLUMNS) {
          throw new BadRequestException(
            'Tables may contain up to ' + MAX_IMPORT_COLUMNS + ' columns',
          );
        }
        if (!row.some(Boolean)) return null;
        if (++records > MAX_PRODUCTS + 1) {
          throw new BadRequestException(
            'A batch may contain up to 500 products',
          );
        }
        return row;
      },
    });
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException(
      'Invalid delimited file. Check quoting and use the same columns in every row.',
    );
  }
}

function tableRows([header, ...rows]: string[][]): ImportRows {
  if (!header) return { format: 'catalog', products: [] };
  if (rows.length > MAX_PRODUCTS) {
    throw new BadRequestException('A batch may contain up to 500 products');
  }
  const keys = Array.from(header, (value) => value?.trim());
  const named = keys.filter(Boolean);
  if (!named.length || named.length !== new Set(named).size) {
    throw new BadRequestException('The table needs unique column headers');
  }
  let size = 0;
  const products = rows.map((row) => {
    const entries: [string, string | string[]][] = [];
    for (const [index, value] of row.entries()) {
      if (!value) continue;
      const key = keys[index];
      if (!key)
        throw new BadRequestException('Every populated column needs a header');
      size += Buffer.byteLength(key) + Buffer.byteLength(value);
      if (size > MAX_IMPORT_BYTES) {
        throw new BadRequestException(
          'The expanded product data exceeds 5 MiB',
        );
      }
      entries.push([
        key,
        /^(?:images|(?:g:)?additional_image_link)$/.test(key)
          ? value
              .split(';')
              .map((item) => item.trim())
              .filter(Boolean)
          : value,
      ]);
    }
    return Object.fromEntries(entries);
  });
  return { format: inferTableFormat(named), products };
}

function inferTableFormat(keys: string[]): ImportFormat {
  if (keys.includes('Артикул')) return 'horoshop';
  if (
    keys.includes('g:id') ||
    (keys.includes('id') && keys.includes('image_link'))
  ) {
    return 'google-shopping';
  }
  return 'catalog';
}

function readFeed(text: string): ImportRows {
  const root = readImportXml(text);
  let items: XmlElement[];
  switch (root.name) {
    case 'rss':
      items =
        root.children
          .find(({ name }) => name === 'channel')
          ?.children.filter(({ name }) => name === 'item') ?? [];
      break;
    case 'feed':
      items = root.children.filter(({ name }) => name === 'entry');
      break;
    case 'products':
      items = root.children.filter(({ name }) => name === 'product');
      break;
    default:
      throw new BadRequestException(
        'Use products/product XML or a Google Shopping RSS or Atom feed',
      );
  }
  if (items.length > MAX_PRODUCTS) {
    throw new BadRequestException('A batch may contain up to 500 products');
  }
  return {
    format: root.name === 'products' ? 'catalog' : 'google-shopping',
    products: items.map(feedRow),
  };
}

function feedRow(item: XmlElement): Row {
  const fields = new Map<string, string | string[]>();
  const images: string[] = [];
  const additional: string[] = [];
  for (const field of item.children) {
    const key = (field.namespace === googleNamespace ? 'g:' : '') + field.name;
    if (key === 'images' || key === 'image') {
      const values = field.children.length
        ? field.children
            .filter(({ name }) => name === 'image')
            .map(({ text }) => text)
        : field.text.split(';');
      for (const value of values) {
        if (value.trim()) images.push(value.trim());
      }
    } else if (
      key === 'g:additional_image_link' ||
      key === 'additional_image_link'
    ) {
      if (field.text.trim()) additional.push(field.text.trim());
    } else if (
      !field.children.length &&
      (key !== 'link' ||
        (!fields.has(key) &&
          (!field.attributes.rel || field.attributes.rel === 'alternate')))
    ) {
      fields.set(
        key,
        key === 'link' ? (field.attributes.href ?? field.text) : field.text,
      );
    }
  }
  if (images.length) fields.set('images', images);
  if (additional.length) fields.set('additional_image_link', additional);
  return Object.fromEntries(fields);
}
