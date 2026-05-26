import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileText, Loader2, Maximize2, PackagePlus, Printer, RotateCcw, Share2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type Transaction } from '../../db';
import { useStore } from '../../store';
import { useToast } from '../../context/ToastContext';
import { getBusinessSettings } from '../../utils/settings';
import { canPerform } from '../../utils/accessControl';
import { downloadDocumentBlob, generateAndShareDocument, generateDocumentPdfBlob } from '../../utils/shareUtils';
import { useTillCash } from '../../hooks/useTillCash';
import { refundNetAmountForLines, refundNetAmountForRemainingItems } from '../../utils/posMoney';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

interface DocumentDetailsModalProps {
  selectedRecord: any | null;
  setSelectedRecord: (record: any | null) => void;
  handleRefund: (t: Transaction, itemsToReturn?: { productId: string, quantity: number }[]) => Promise<void>;
  onApprove?: (record: any) => Promise<void>;
  onReject?: (record: any) => Promise<void>;
  onReceive?: (record: any) => void;
  extraActions?: React.ReactNode;
}

const parseList = (value: any): any[] => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const RECEIPT_PREVIEW_WIDTH_REM = 20;

const moneyText = (value: unknown) => `Ksh ${(Number(value) || 0).toLocaleString()}`;

type PdfPageImage = {
  height: number;
  page: number;
  src: string;
  width: number;
};

function PdfCanvasPreview({
  blob,
  filename,
  onDownload,
  title,
  zoom,
}: {
  blob: Blob | null;
  filename: string;
  onDownload: () => void;
  title: string;
  zoom: number;
}) {
  const [pages, setPages] = useState<PdfPageImage[]>([]);
  const [isRendering, setIsRendering] = useState(false);
  const [renderError, setRenderError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const renderPdf = async () => {
      if (!blob) {
        setPages([]);
        setRenderError('');
        return;
      }

      setIsRendering(true);
      setRenderError('');
      try {
        const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
        (pdfjs as any).GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

        const data = new Uint8Array(await blob.arrayBuffer());
        const pdf = await (pdfjs as any).getDocument({ data, disableWorker: true }).promise;
        const nextPages: PdfPageImage[] = [];
        const renderScale = Math.max(1.6, Math.min(2.6, window.devicePixelRatio || 1.6));

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          if (cancelled) break;
          const page = await pdf.getPage(pageNumber);
          const viewport = page.getViewport({ scale: renderScale });
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Canvas is not available on this device.');

          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          await page.render({ canvasContext: context, viewport }).promise;
          nextPages.push({
            page: pageNumber,
            src: canvas.toDataURL('image/png'),
            width: canvas.width,
            height: canvas.height,
          });
          page.cleanup?.();
        }

        await pdf.destroy?.();
        if (!cancelled) setPages(nextPages);
      } catch (err: any) {
        console.error('PDF render failed:', err);
        if (!cancelled) setRenderError(err?.message || 'Could not render this PDF preview.');
      } finally {
        if (!cancelled) setIsRendering(false);
      }
    };

    void renderPdf();
    return () => { cancelled = true; };
  }, [blob]);

  if (isRendering && pages.length === 0) {
    return (
      <div className="flex min-h-96 items-center justify-center rounded-lg bg-white text-sm font-bold text-slate-500">
        <Loader2 size={18} className="mr-2 animate-spin text-blue-700" />
        Rendering PDF preview...
      </div>
    );
  }

  if (renderError) {
    return (
      <div className="flex min-h-96 flex-col items-center justify-center gap-3 rounded-lg border border-slate-300 bg-white p-5 text-center">
        <p className="text-sm font-black text-slate-900">PDF preview could not render.</p>
        <p className="text-xs font-semibold text-slate-500">{renderError}</p>
        <button
          type="button"
          onClick={onDownload}
          className="mt-2 flex h-10 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-xs font-bold text-white"
        >
          <Download size={15} />
          Download {filename}.pdf
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3 pb-4" data-pdf-zoom={zoom}>
      {pages.map(page => (
        <img
          key={page.page}
          src={page.src}
          width={page.width}
          height={page.height}
          alt={`${title} page ${page.page}`}
          className="block h-auto w-full rounded-lg bg-white shadow-sm"
        />
      ))}
      {isRendering && (
        <div className="rounded-lg border border-slate-300 bg-white p-3 text-center text-xs font-bold text-slate-500">
          Rendering more pages...
        </div>
      )}
    </div>
  );
}

function documentLabel(record: any) {
  switch (record?.recordType) {
    case 'SALE': return 'Receipt';
    case 'REFUND': return 'Refund';
    case 'EXPENSE': return 'Expense';
    case 'SUPPLIER_PAYMENT': return 'Supplier-Payment';
    case 'CREDIT_NOTE': return 'Credit-Note';
    case 'SALES_INVOICE': return 'Invoice';
    case 'PURCHASE_ORDER': return 'LPO';
    case 'CLOSE_DAY_REPORT': return 'Shift-Report';
    case 'DAILY_SUMMARY': return 'Daily-Summary';
    default: return 'Document';
  }
}

function documentFilename(record: any) {
  const label = documentLabel(record);
  const ref = String(record?.receiptNumber || record?.invoiceNumber || record?.poNumber || record?.refundNumber || record?.reference || record?.id || Date.now())
    .split('-')[0]
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '');
  return `${label}-${ref || 'DOC'}`;
}

export default function DocumentPdfModalView({
  selectedRecord,
  setSelectedRecord,
  handleRefund,
  onApprove,
  onReject,
  onReceive,
  extraActions,
}: DocumentDetailsModalProps) {
  const { success, error: toastError } = useToast();
  const currentUser = useStore(state => state.currentUser);
  const isAdmin = useStore(state => state.isAdmin);
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const businessSettings = useLiveQuery(() => getBusinessSettings(activeBusinessId), [activeBusinessId]);
  const supplier = useLiveQuery(
    () => (selectedRecord?.recordType === 'SUPPLIER_PAYMENT' || selectedRecord?.recordType === 'PURCHASE_ORDER' || selectedRecord?.recordType === 'CREDIT_NOTE')
      ? db.suppliers.get(selectedRecord.supplierId)
      : Promise.resolve(null),
    [selectedRecord]
  );
  const tillCash = useTillCash();
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [objectUrl, setObjectUrl] = useState('');
  const [preparedRecord, setPreparedRecord] = useState<any | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [isApprovalActionRunning, setIsApprovalActionRunning] = useState(false);
  const [isRefunding, setIsRefunding] = useState(false);
  const [pdfZoom, setPdfZoom] = useState(100);
  const [isZoomCustom, setIsZoomCustom] = useState(false);

  const storeName = businessSettings?.storeName || 'Smart POS';
  const storeLocation = businessSettings?.location || 'Nairobi, Kenya';
  const canRequestRefund = canPerform(currentUser, 'sale.refund.request', businessSettings);
  const filename = useMemo(() => documentFilename(selectedRecord), [selectedRecord]);
  const title = useMemo(() => `${documentLabel(selectedRecord).replace(/-/g, ' ')} PDF`, [selectedRecord]);

  const isSale = selectedRecord?.recordType === 'SALE';
  const isReceiptSized = selectedRecord?.recordType === 'SALE' || selectedRecord?.recordType === 'EXPENSE';
  const isPO = selectedRecord?.recordType === 'PURCHASE_ORDER';
  const isPendingApproval = isAdmin && onApprove && onReject && (
    (selectedRecord?.recordType === 'PURCHASE_ORDER' && selectedRecord?.approvalStatus === 'PENDING') ||
    (selectedRecord?.recordType === 'EXPENSE' && selectedRecord?.status === 'PENDING') ||
    (selectedRecord?.recordType === 'SALE' && selectedRecord?.status === 'PENDING_REFUND')
  );
  const canReceive = !!(onReceive && isPO && selectedRecord?.approvalStatus === 'APPROVED' && selectedRecord?.status === 'PENDING');
  const pendingRefundLines = parseList(selectedRecord?.pendingRefundItems);
  const refundAmount = isSale
    ? (pendingRefundLines.length > 0
      ? refundNetAmountForLines(selectedRecord, pendingRefundLines)
      : refundNetAmountForRemainingItems(selectedRecord))
    : 0;
  const refundBlocked = isAdmin && isSale && refundAmount > 0 && (!tillCash.hasOpenShift || tillCash.actualCashDrawer + 0.01 < refundAmount);

  useEffect(() => {
    if (!pdfBlob) {
      setObjectUrl('');
      return;
    }
    const nextUrl = URL.createObjectURL(pdfBlob);
    setObjectUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [pdfBlob]);

  useEffect(() => {
    let cancelled = false;

    const prepare = async () => {
      if (!selectedRecord) {
        setPdfBlob(null);
        setPreparedRecord(null);
        return;
      }

      setIsPreparing(true);
      setPdfBlob(null);
      setPreparedRecord(null);
      try {
        const recordWithDetails = {
          ...selectedRecord,
          shopName: selectedRecord.shopName || storeName,
          tillNumber: selectedRecord.tillNumber || businessSettings?.tillNumber,
          businessAddress: selectedRecord.businessAddress || storeLocation,
          receiptFooter: selectedRecord.receiptFooter || businessSettings?.receiptFooter || 'Thank you for shopping!',
        };

        if (selectedRecord.recordType === 'SUPPLIER_PAYMENT') {
          const invoiceAllocations = parseList(selectedRecord.invoiceAllocations);
          const allocationAmountById = new Map(invoiceAllocations.map((allocation: any) => [String(allocation.purchaseOrderId || '').trim(), Number(allocation.amount || 0)] as const));
          const purchaseOrderIds = invoiceAllocations.length > 0
            ? invoiceAllocations.map((allocation: any) => allocation.purchaseOrderId).filter(Boolean)
            : (parseList(selectedRecord.purchaseOrderIds).length > 0 ? parseList(selectedRecord.purchaseOrderIds) : (selectedRecord.purchaseOrderId ? [selectedRecord.purchaseOrderId] : []));
          const purchaseOrders = await db.purchaseOrders.bulkGet(purchaseOrderIds);
          recordWithDetails.invoiceDetails = purchaseOrders.filter(Boolean).map((order: any) => ({
            date: order.orderDate,
            ref: order.invoiceNumber || String(order.id || '').split('-')[0],
            amount: allocationAmountById.get(order.id) || order.totalAmount,
          }));

          const creditNoteIds = parseList(selectedRecord.creditNoteIds);
          if (creditNoteIds.length > 0) {
            const creditNotes = await db.creditNotes.bulkGet(creditNoteIds);
            recordWithDetails.creditNoteDetails = creditNotes.filter(Boolean).map((note: any) => ({
              date: note.timestamp,
              ref: note.reference || 'CRN',
              amount: note.amount,
            }));
          } else {
            const creditNotes = await db.creditNotes.where('allocatedTo').equals(selectedRecord.id).toArray();
            recordWithDetails.creditNoteDetails = creditNotes.map(note => ({
              date: note.timestamp,
              ref: note.reference || 'CRN',
              amount: note.amount,
            }));
          }
        }

        const blob = generateDocumentPdfBlob(recordWithDetails, supplier, storeName, storeLocation);
        if (!cancelled) {
          setPreparedRecord(recordWithDetails);
          setPdfBlob(blob);
        }
      } catch (err) {
        console.error('PDF preview failed:', err);
        if (!cancelled) toastError('PDF generation failed. Please try again.');
      } finally {
        if (!cancelled) setIsPreparing(false);
      }
    };

    void prepare();
    return () => { cancelled = true; };
  }, [businessSettings, selectedRecord, storeLocation, storeName, supplier, toastError]);

  useEffect(() => {
    setPdfZoom(100);
    setIsZoomCustom(false);
  }, [selectedRecord?.id, selectedRecord?.recordType]);

  if (!selectedRecord) return null;

  const close = () => setSelectedRecord(null);
  const viewerUrl = objectUrl ? `${objectUrl}#toolbar=0&navpanes=0&scrollbar=1&view=FitH` : '';
  const frameWidth = isReceiptSized
    ? `${RECEIPT_PREVIEW_WIDTH_REM * (pdfZoom / 100)}rem`
    : isZoomCustom
      ? `${pdfZoom}%`
      : '100%';
  const frameMaxWidth = isReceiptSized || isZoomCustom ? 'none' : '100%';

  const changeZoom = (delta: number) => {
    setIsZoomCustom(true);
    setPdfZoom(prev => Math.min(200, Math.max(50, prev + delta)));
  };

  const resetZoom = () => {
    setPdfZoom(100);
    setIsZoomCustom(false);
  };

  const printPdf = () => {
    if (!objectUrl) {
      if (pdfBlob) downloadDocumentBlob(pdfBlob, filename);
      return;
    }
    try {
      const printFrame = document.createElement('iframe');
      printFrame.src = viewerUrl;
      printFrame.title = `${title} print`;
      printFrame.style.position = 'fixed';
      printFrame.style.right = '0';
      printFrame.style.bottom = '0';
      printFrame.style.width = '0';
      printFrame.style.height = '0';
      printFrame.style.border = '0';
      printFrame.onload = () => {
        try {
          printFrame.contentWindow?.focus();
          printFrame.contentWindow?.print();
        } finally {
          window.setTimeout(() => printFrame.remove(), 1000);
        }
      };
      document.body.appendChild(printFrame);
    } catch {
      if (pdfBlob) downloadDocumentBlob(pdfBlob, filename);
    }
  };

  const sharePdf = async () => {
    if (!preparedRecord) return;
    setIsSharing(true);
    try {
      await generateAndShareDocument(preparedRecord, filename, supplier, false, storeName, storeLocation);
      success('PDF ready.');
    } catch (err) {
      console.error('Share failed:', err);
      toastError('Could not share the PDF.');
    } finally {
      setIsSharing(false);
    }
  };

  const approveOrReject = async (action?: (record: any) => Promise<void>) => {
    if (!action || isApprovalActionRunning) return;
    setIsApprovalActionRunning(true);
    try {
      await action(selectedRecord);
      close();
    } finally {
      setIsApprovalActionRunning(false);
    }
  };

  const requestRefund = async () => {
    if (!isSale || isRefunding) return;
    if (refundBlocked) {
      toastError(!tillCash.hasOpenShift
        ? 'Open a till shift before approving a cash refund.'
        : `Till has ${moneyText(tillCash.actualCashDrawer)} available. Add cash before refunding ${moneyText(refundAmount)}.`);
      return;
    }
    setIsRefunding(true);
    try {
      await handleRefund(selectedRecord);
      close();
    } finally {
      setIsRefunding(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-slate-950/70 p-0 backdrop-blur-sm sm:p-4">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close PDF" onClick={close} />

      <section className={`relative z-10 flex h-full w-full flex-col overflow-hidden bg-slate-50 shadow-2xl sm:h-[94vh] sm:rounded-lg ${isReceiptSized ? 'max-w-[38rem]' : 'max-w-6xl'}`}>
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-blue-100 bg-blue-50 text-blue-700">
              <FileText size={20} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-slate-950">{title}</p>
              <p className="truncate text-[11px] font-bold text-slate-500">{filename}.pdf</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <div className="hidden items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 sm:flex" aria-label="PDF zoom controls">
              <button
                type="button"
                onClick={() => changeZoom(-10)}
                disabled={!pdfBlob || pdfZoom <= 50}
                className="flex h-8 w-8 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-100 disabled:opacity-40"
                aria-label="Zoom out"
                title="Zoom out"
              >
                <ZoomOut size={16} />
              </button>
              <button
                type="button"
                onClick={resetZoom}
                disabled={!pdfBlob}
                className="flex h-8 min-w-12 items-center justify-center gap-1 rounded-md px-2 text-[11px] font-black text-slate-700 transition hover:bg-slate-100 disabled:opacity-40"
                aria-label="Reset PDF zoom"
                title={isReceiptSized ? 'Reset to receipt size' : 'Fit to width'}
              >
                {isZoomCustom || isReceiptSized ? `${pdfZoom}%` : <Maximize2 size={15} />}
              </button>
              <button
                type="button"
                onClick={() => changeZoom(10)}
                disabled={!pdfBlob || pdfZoom >= 200}
                className="flex h-8 w-8 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-100 disabled:opacity-40"
                aria-label="Zoom in"
                title="Zoom in"
              >
                <ZoomIn size={16} />
              </button>
            </div>
            <button
              type="button"
              onClick={sharePdf}
              disabled={!preparedRecord || isSharing}
              className="hidden h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 sm:flex"
            >
              {isSharing ? <Loader2 size={16} className="animate-spin" /> : <Share2 size={16} />}
              Share
            </button>
            <button
              type="button"
              onClick={printPdf}
              disabled={!pdfBlob}
              className="hidden h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 sm:flex"
            >
              <Printer size={16} />
              Print
            </button>
            <button
              type="button"
              onClick={() => pdfBlob && downloadDocumentBlob(pdfBlob, filename)}
              disabled={!pdfBlob}
              className="flex h-10 items-center justify-center gap-2 rounded-lg bg-slate-950 px-3 text-xs font-bold text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              <Download size={16} />
              Download
            </button>
            <button
              type="button"
              onClick={close}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
              aria-label="Close PDF"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <div className={`min-h-0 flex-1 overflow-auto bg-slate-200 ${isReceiptSized ? 'p-3 sm:p-5' : 'p-0 sm:p-3'}`}>
          {pdfBlob ? (
            <div className="flex h-full min-h-0 w-full flex-col">
              <div className="mb-2 flex items-center justify-center gap-1 sm:hidden">
                <button
                  type="button"
                  onClick={() => changeZoom(-10)}
                  disabled={!pdfBlob || pdfZoom <= 50}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 disabled:opacity-40"
                  aria-label="Zoom out"
                >
                  <ZoomOut size={16} />
                </button>
                <button
                  type="button"
                  onClick={resetZoom}
                  disabled={!pdfBlob}
                  className="flex h-9 min-w-16 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-black text-slate-700 disabled:opacity-40"
                  aria-label="Reset PDF zoom"
                >
                  {isZoomCustom || isReceiptSized ? `${pdfZoom}%` : 'Fit'}
                </button>
                <button
                  type="button"
                  onClick={() => changeZoom(10)}
                  disabled={!pdfBlob || pdfZoom >= 200}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 disabled:opacity-40"
                  aria-label="Zoom in"
                >
                  <ZoomIn size={16} />
                </button>
              </div>
              <div
                className="mx-auto min-h-0 flex-1"
                style={{ width: frameWidth, maxWidth: frameMaxWidth }}
              >
                <PdfCanvasPreview
                  blob={pdfBlob}
                  filename={filename}
                  onDownload={() => downloadDocumentBlob(pdfBlob, filename)}
                  title={title}
                  zoom={pdfZoom}
                />
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center bg-white text-sm font-bold text-slate-500">
              {isPreparing ? 'Preparing PDF preview...' : 'PDF preview unavailable.'}
            </div>
          )}
        </div>

        {(canReceive || isPendingApproval || (isSale && canRequestRefund) || extraActions) && (
          <footer className="shrink-0 border-t border-slate-200 bg-white p-3 sm:p-4">
            {isSale && canRequestRefund && (
              <div className="mb-3 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-bold text-orange-800">
                Cash refund from till: {moneyText(refundAmount)}. The till must have enough cash before approval.
              </div>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              {extraActions}

              {canReceive && (
                <button
                  type="button"
                  onClick={() => { onReceive?.(selectedRecord); close(); }}
                  className="flex h-11 items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 text-xs font-black uppercase tracking-widest text-white"
                >
                  <PackagePlus size={16} />
                  Receive items
                </button>
              )}

              {isPendingApproval && (
                <>
                  <button
                    type="button"
                    onClick={() => approveOrReject(onApprove)}
                    disabled={isApprovalActionRunning || (selectedRecord?.recordType === 'SALE' && selectedRecord?.status === 'PENDING_REFUND' && refundBlocked)}
                    className="flex h-11 items-center justify-center gap-2 rounded-lg bg-green-700 px-4 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50"
                  >
                    {isApprovalActionRunning ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => approveOrReject(onReject)}
                    disabled={isApprovalActionRunning}
                    className="flex h-11 items-center justify-center gap-2 rounded-lg bg-red-700 px-4 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50"
                  >
                    <AlertTriangle size={16} />
                    Reject
                  </button>
                </>
              )}

              {isSale && canRequestRefund && !isPendingApproval && (
                <button
                  type="button"
                  onClick={requestRefund}
                  disabled={isRefunding || (selectedRecord.status !== 'PAID' && selectedRecord.status !== 'PARTIAL_REFUND')}
                  className="flex h-11 items-center justify-center gap-2 rounded-lg bg-orange-700 px-4 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50"
                >
                  {isRefunding ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
                  {isAdmin ? 'Return receipt' : 'Request return'}
                </button>
              )}
            </div>
          </footer>
        )}
      </section>
    </div>
  );
}
