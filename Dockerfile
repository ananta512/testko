FROM node:18-alpine
WORKDIR /app

# Copy only package.json + (optional) package-lock.json
COPY package*.json ./

# Instead of 'npm ci', install production deps even without a lockfile
RUN npm install --only=production

COPY . .
CMD ["node", "index.js"]
