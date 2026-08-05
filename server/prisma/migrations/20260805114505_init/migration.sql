-- CreateTable
CREATE TABLE "DarazAccount" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "country" TEXT NOT NULL,
    "sellerId" TEXT,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "tokenExpiresAt" DATETIME NOT NULL,
    "refreshTokenExpiresAt" DATETIME NOT NULL,
    "connectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "descriptionHtml" TEXT,
    "vendor" TEXT,
    "imagesJson" TEXT NOT NULL DEFAULT '[]',
    "darazCategoryId" TEXT,
    "attributesJson" TEXT,
    "darazItemId" TEXT,
    "darazSkuId" TEXT,
    "syncStatus" TEXT NOT NULL DEFAULT 'unmapped',
    "lastSyncedAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "price" TEXT NOT NULL,
    "compareAtPrice" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "packageWeightKg" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DarazOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "darazOrderId" TEXT NOT NULL,
    "orderNumber" TEXT,
    "customerName" TEXT,
    "status" TEXT NOT NULL,
    "itemsCount" INTEGER NOT NULL DEFAULT 0,
    "totalAmount" TEXT,
    "currency" TEXT,
    "darazCreatedAt" DATETIME,
    "darazUpdatedAt" DATETIME,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DarazOrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "darazOrderItemId" TEXT NOT NULL,
    "sku" TEXT,
    "name" TEXT,
    "imageUrl" TEXT,
    "price" TEXT,
    "currency" TEXT,
    "status" TEXT,
    CONSTRAINT "DarazOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "DarazOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Product_syncStatus_idx" ON "Product"("syncStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_productId_sku_key" ON "ProductVariant"("productId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "DarazOrder_darazOrderId_key" ON "DarazOrder"("darazOrderId");

-- CreateIndex
CREATE INDEX "DarazOrder_darazCreatedAt_idx" ON "DarazOrder"("darazCreatedAt");

-- CreateIndex
CREATE INDEX "DarazOrderItem_orderId_idx" ON "DarazOrderItem"("orderId");
