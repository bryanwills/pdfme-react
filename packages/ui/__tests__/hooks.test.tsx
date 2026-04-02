import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import type { Template } from '@pdfme/common';
import * as converter from '@pdfme/converter';
import { useUIPreProcessor } from '../src/hooks';

vi.mock('@pdfme/converter', () => ({
  pdf2size: vi.fn(),
  pdf2img: vi.fn(),
}));

const createTemplate = (): Template => ({
  basePdf: 'data:application/pdf;base64,AA==',
  schemas: [[]],
});

test('useUIPreProcessor stores converter failures without unhandled rejections', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const pdf2sizeMock = vi.mocked(converter.pdf2size);
  const pdf2imgMock = vi.mocked(converter.pdf2img);
  const template = createTemplate();
  const size = { width: 1200, height: 1200 };

  pdf2sizeMock.mockRejectedValue(new Error('corrupt basePdf'));

  const { result } = renderHook(() =>
    useUIPreProcessor({
      template,
      size,
      zoomLevel: 1,
      maxZoom: 1,
    }),
  );

  await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));

  expect(result.current.error?.message).toContain('corrupt basePdf');
  expect(pdf2imgMock).not.toHaveBeenCalled();
});
