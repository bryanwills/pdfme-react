import type { Plugin, Schema } from '@pdfme/common';
import { ZOOM } from '@pdfme/common';
import image from './image.js';

type SignatureSchema = Schema;

const getEffectiveScale = (element: HTMLElement | null) => {
  let scale = 1;
  while (element && element !== document.body) {
    const style = window.getComputedStyle(element);
    const transform = style.transform;
    if (transform && transform !== 'none') {
      const localScale = parseFloat(transform.match(/matrix\((.+)\)/)?.[1].split(', ')[3] || '1');
      scale *= localScale;
    }
    element = element.parentElement;
  }
  return scale;
};

const signature: Plugin<SignatureSchema> = {
  ui: async (arg) => {
    const { schema, value, onChange, rootElement, mode, i18n } = arg;
    const { default: SignaturePad } = await import('signature_pad');

    const canvas = document.createElement('canvas');
    canvas.width = schema.width * ZOOM;
    canvas.height = schema.height * ZOOM;

    const context = canvas.getContext('2d');
    if (context) {
      const resetScale = 1 / getEffectiveScale(rootElement);
      context.scale(resetScale, resetScale);

      const signaturePad = new SignaturePad(canvas);
      const handleEndStroke = () => {
        const data = signaturePad.toDataURL('image/png');
        if (onChange && data) {
          onChange({ key: 'content', value: data });
        }
      };

      try {
        if (value) {
          void signaturePad.fromDataURL(value, { ratio: resetScale });
        } else {
          signaturePad.clear();
        }
      } catch (error) {
        console.error(error);
      }

      if (mode === 'viewer' || (mode === 'form' && schema.readOnly)) {
        signaturePad.off();
      } else {
        signaturePad.on();
        const clearButton = document.createElement('button');
        const handleClear = () => {
          if (onChange) {
            onChange({ key: 'content', value: '' });
          }
        };
        const cleanup = () => {
          signaturePad.off();
          signaturePad.removeEventListener('endStroke', handleEndStroke);
          clearButton.removeEventListener('click', handleClear);
          clearButton.remove();
          rootElement.removeEventListener('beforeRemove', cleanup);
        };

        rootElement.addEventListener('beforeRemove', cleanup);
        clearButton.type = 'button';
        clearButton.style.position = 'absolute';
        clearButton.style.zIndex = '1';
        clearButton.textContent = i18n('signature.clear') || 'x';
        clearButton.addEventListener('click', handleClear);
        rootElement.appendChild(clearButton);
        signaturePad.addEventListener('endStroke', handleEndStroke);
      }
    }

    rootElement.appendChild(canvas);
  },
  pdf: image.pdf,
  propPanel: {
    schema: {},
    defaultSchema: {
      name: '',
      type: 'signature',
      content: '',
      position: { x: 0, y: 0 },
      width: 62.5,
      height: 37.5,
    },
  },
};

export default signature;
