FROM node:22-alpine
ENV NODE_ENV=production TZ=UTC DB_PATH=/data/utilisateurs.sqlite PORT=3000
WORKDIR /app
# Aucune dépendance npm : on copie simplement le code.
COPY package.json server.js db.js docstore.js sports.js ./
COPY providers ./providers
COPY sms ./sms
COPY public ./public
COPY data ./data
COPY deploy ./deploy
RUN node deploy/fetch-vendor.js || echo 'jsQR non installé : lecteur QR du navigateur seulement'
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
