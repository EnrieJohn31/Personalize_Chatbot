FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS node-runtime
FROM php:8.4.27-cli-bookworm@sha256:496b5e02fe9fe44fcfb715023b931048111dc4e0bc719789d83c906be9f04b05

ARG WWWGROUP=1000

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl git gosu unzip libicu-dev libonig-dev libzip-dev \
    && docker-php-ext-install -j2 bcmath intl mbstring pcntl pdo_mysql zip \
    && rm -rf /var/lib/apt/lists/*

COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && curl -fsSL https://getcomposer.org/download/2.10.3/composer.phar -o /usr/local/bin/composer \
    && echo '7a2d379d5b8ffdaa028580ef26494c36d2feef4b178d3dd1473a4dbc5e17c8d6  /usr/local/bin/composer' | sha256sum -c - \
    && chmod +x /usr/local/bin/composer \
    && groupadd --gid "${WWWGROUP}" sail \
    && useradd --uid 1000 --gid "${WWWGROUP}" --create-home --shell /bin/bash sail

COPY php.ini /usr/local/etc/php/conf.d/99-development.ini
COPY start-container /usr/local/bin/start-container
RUN chmod +x /usr/local/bin/start-container \
    && git config --system --add safe.directory /var/www/html

ENV HOME=/home/sail
WORKDIR /var/www/html
EXPOSE 8000 5173
ENTRYPOINT ["start-container"]
CMD ["php", "artisan", "serve", "--host=0.0.0.0", "--port=8000"]
