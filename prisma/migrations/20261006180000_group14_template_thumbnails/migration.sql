-- Group 14 Phase D — template JPEG thumbnails (old thumbnailJpeg + thumbnailGeneratedAt).
ALTER TABLE "InvoiceTemplate" ADD COLUMN "thumbnailJpeg" BLOB;
ALTER TABLE "InvoiceTemplate" ADD COLUMN "thumbnailGeneratedAt" DATETIME;
