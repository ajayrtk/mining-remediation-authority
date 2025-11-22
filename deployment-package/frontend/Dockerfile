# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Install Python3 for map validation
RUN apk add --no-cache python3

# Copy built application from builder
COPY --from=builder /app/build ./build
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules

# Copy validation script
COPY validate_map.py ./

# Expose port
EXPOSE 3000

# Set environment to production
ENV NODE_ENV=production

# Set body size limit to 200MB for map file validation (default is 512KB)
ENV BODY_SIZE_LIMIT=209715200

# Start the application
CMD ["node", "build"]
