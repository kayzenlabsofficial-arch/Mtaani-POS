import React, { useEffect, useRef, useState } from 'react';
import { Download, FileText, Printer, X } from 'lucide-react';
import { downloadDocumentBlob } from '../../utils/shareUtils';

interface PdfPreviewModalProps {
  blob: Blob;
  filename: string;
  title?: string;
  onClose: () => void;
}

export default function PdfPreviewModal({ blob, filename, title = 'PDF preview', onClose }: PdfPreviewModalProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const url = URL.createObjectURL(blob);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  const handleDownload = () => {
    downloadDocumentBlob(blob, filename);
  };

  const handlePrint = () => {
    try {
      const frame = iframeRef.current;
      frame?.contentWindow?.focus();
      frame?.contentWindow?.print();
    } catch {
      handleDownload();
    }
  };

  const viewerUrl = objectUrl ? `${objectUrl}#toolbar=0&navpanes=0&scrollbar=1&view=FitH` : '';

  return (
    <div className="fixed inset-0 z-[90] flex items-stretch justify-center bg-slate-950/70 p-0 backdrop-blur-sm sm:p-4">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close PDF preview"
        onClick={onClose}
      />

      <section className="relative z-10 flex h-full w-full max-w-6xl flex-col overflow-hidden bg-slate-50 shadow-2xl sm:h-[94vh] sm:rounded-2xl">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <FileText size={20} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-slate-900">{title}</p>
              <p className="truncate text-[11px] font-bold text-slate-500">{filename}.pdf</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="hidden h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50 sm:flex"
            >
              <Printer size={16} />
              Print
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="flex h-10 items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 text-xs font-bold text-white transition-colors hover:bg-slate-800"
            >
              <Download size={16} />
              Download
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50"
              aria-label="Close PDF preview"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 bg-slate-200 p-0 sm:p-3">
          {viewerUrl ? (
            <iframe
              ref={iframeRef}
              src={viewerUrl}
              title={title}
              className="h-full w-full border-0 bg-white sm:rounded-xl sm:shadow-sm"
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-white text-sm font-bold text-slate-500">
              Preparing PDF preview...
            </div>
          )}
        </div>

      </section>
    </div>
  );
}
