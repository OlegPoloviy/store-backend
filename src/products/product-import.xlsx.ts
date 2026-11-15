import { BadRequestException } from '@nestjs/common';
import { posix } from 'node:path';
import { TextDecoder } from 'node:util';
import { Entry, fromBuffer, ZipFile } from 'yauzl';
import { MAX_PRODUCTS } from './product-import.parser';
import { readImportXml, XmlElement } from './product-import.xml';

export const MAX_IMPORT_COLUMNS = 200;
const MAX_EXPANDED_BYTES = 20 * 1024 * 1024;

export async function readImportWorkbook(buffer: Buffer): Promise<string[][]> {
  try {
    const zip = await new Promise<ZipFile>((resolve, reject) => {
      fromBuffer(buffer, { lazyEntries: true }, (error, file) =>
        error ? reject(error) : resolve(file),
      );
    });
    try {
      if (zip.entryCount > 512) throw new Error('Too many workbook parts');
      const entries = new Map<string, Entry>();
      for await (const entry of zip.eachEntry()) {
        if (entries.has(entry.fileName)) throw new Error('Duplicate part');
        entries.set(entry.fileName, entry);
      }

      let remaining = MAX_EXPANDED_BYTES;
      async function part(path: string) {
        const entry = entries.get(path);
        if (!entry || entry.uncompressedSize > remaining) {
          throw new Error('Missing or oversized workbook part');
        }
        const stream = await zip.openReadStreamPromise(entry);
        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
          remaining -= chunk.length;
          if (remaining < 0) throw new Error('Oversized workbook');
          chunks.push(chunk);
        }
        return readImportXml(
          new TextDecoder('utf-8', { fatal: true }).decode(
            Buffer.concat(chunks),
          ),
        );
      }

      const workbook = await part('xl/workbook.xml');
      const relations = await part('xl/_rels/workbook.xml.rels');
      const firstSheet = child(workbook, 'sheets')?.children[0];
      function relatedPart(type: string, id?: string) {
        const relation = relations.children.find(
          ({ attributes }) =>
            attributes.Type?.endsWith('/' + type) &&
            (id === undefined || attributes.Id === id),
        );
        const target = relation?.attributes.Target;
        if (!target || relation.attributes.TargetMode === 'External') return;
        return target.startsWith('/')
          ? posix.normalize(target).slice(1)
          : posix.join('xl', target);
      }
      const sheetId = firstSheet?.attributes['r:id'];
      const sheetPath = sheetId && relatedPart('worksheet', sheetId);
      if (!sheetPath) throw new Error('Missing first worksheet');
      const worksheet = await part(sheetPath);
      const stringsPath = relatedPart('sharedStrings');
      const strings = stringsPath
        ? (await part(stringsPath)).children
            .filter(({ name }) => name === 'si')
            .map(richText)
        : [];
      const rows: string[][] = [];
      for (const row of child(worksheet, 'sheetData')?.children ?? []) {
        if (row.name !== 'row') continue;
        const values = readRow(row, strings);
        if (!values.some(Boolean)) continue;
        rows.push(values);
        if (rows.length > MAX_PRODUCTS + 1) {
          throw new BadRequestException(
            'A batch may contain up to 500 products',
          );
        }
      }
      return rows;
    } finally {
      zip.close();
    }
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException('Upload a valid Excel (.xlsx) workbook');
  }
}

function child(node: XmlElement, name: string) {
  return node.children.find((element) => element.name === name);
}

function richText(node: XmlElement) {
  return node.children
    .map((element) =>
      element.name === 't'
        ? element.text
        : element.name === 'r'
          ? child(element, 't')?.text
          : undefined,
    )
    .join('');
}

function readRow(row: XmlElement, strings: string[]) {
  const cells: string[] = [];
  let column = 0;
  for (const cell of row.children) {
    if (cell.name !== 'c') continue;
    const type = cell.attributes.t;
    const value = child(cell, 'v')?.text;
    const inline = child(cell, 'is');
    if (value === undefined && !inline) continue;
    const reference = /^([A-Z]{1,3})[1-9][0-9]*$/.exec(cell.attributes.r ?? '');
    if (reference) {
      column =
        [...reference[1]].reduce(
          (index, letter) => index * 26 + letter.charCodeAt(0) - 64,
          0,
        ) - 1;
    }
    if (column >= MAX_IMPORT_COLUMNS) {
      throw new BadRequestException(
        'Excel worksheets may contain up to ' + MAX_IMPORT_COLUMNS + ' columns',
      );
    }
    cells[column++] =
      type === 's'
        ? strings[Number(value)]
        : type === 'inlineStr' && inline
          ? richText(inline)
          : type === 'b'
            ? value === '1'
              ? 'true'
              : 'false'
            : value;
  }
  return cells;
}
