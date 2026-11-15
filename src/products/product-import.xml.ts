import { BadRequestException } from '@nestjs/common';
import { SaxesParser } from 'saxes';

export type XmlElement = {
  name: string;
  namespace: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  text: string;
};

export function readImportXml(input: string): XmlElement {
  const parser = new SaxesParser({ xmlns: true });
  const stack: XmlElement[] = [];
  let root: XmlElement;
  let elements = 0;
  parser.on('doctype', () => {
    throw new BadRequestException('XML document types are not supported');
  });
  parser.on('opentag', (tag) => {
    if (stack.length >= 32 || ++elements > 250_000) {
      throw new BadRequestException('The XML document is too complex');
    }
    const node = {
      name: tag.local,
      namespace: tag.uri,
      attributes: Object.fromEntries(
        Object.values(tag.attributes).map(({ name, value }) => [name, value]),
      ),
      children: [],
      text: '',
    };
    const parent = stack.at(-1);
    if (parent) parent.children.push(node);
    else root = node;
    stack.push(node);
  });
  parser.on('closetag', () => stack.pop());
  const appendText = (text: string) => {
    const node = stack.at(-1);
    if (node) node.text += text;
  };
  parser.on('text', appendText);
  parser.on('cdata', appendText);
  try {
    parser.write(input).close();
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException('The file contains malformed XML');
  }
  return root;
}
