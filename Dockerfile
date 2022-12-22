# pip dependencies install stage
FROM python:3.10-slim as builder

# See `cryptography` pin comment in requirements.txt
ARG CRYPTOGRAPHY_DONT_BUILD_RUST=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ \
    gcc \
    libc-dev \
    libffi-dev \
    libjpeg-dev \
    libssl-dev \
    libxslt-dev \
    make \
    zlib1g-dev

RUN mkdir /install
WORKDIR /install

COPY requirements.txt /requirements.txt

RUN pip install --target=/dependencies -r /requirements.txt

# Playwright is an alternative to Selenium
# Excluded this package from requirements.txt to prevent arm/v6 and arm/v7 builds from failing
# https://github.com/dgtlmoon/changedetection.io/pull/1067 also musl/alpine (not supported)
RUN pip install --target=/dependencies playwright~=1.27.1 \
    || echo "WARN: Failed to install Playwright. The application can still run, but the Playwright option will be disabled."

# Final image stage
FROM python:3.10-slim


RUN set -ex; \
    apt-get update && apt-get install -y --no-install-recommends \
        gosu \
        libssl1.1 \
        libxslt1.1 \
        # For pdftohtml
        poppler-utils \
        zlib1g && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*; \
    useradd -u 911 -U -d /datastore -s /bin/false changedetection && \
    usermod -G users changedetection; \
    mkdir -p /datastore

# https://stackoverflow.com/questions/58701233/docker-logs-erroneously-appears-empty-until-container-stops
ENV PYTHONUNBUFFERED=1

# Re #80, sets SECLEVEL=1 in openssl.conf to allow monitoring sites with weak/old cipher suites
RUN sed -i 's/^CipherString = .*/CipherString = DEFAULT@SECLEVEL=1/' /etc/ssl/openssl.cnf

# Copy modules over to the final image and add their dir to PYTHONPATH
COPY --from=builder /dependencies /usr/local
ENV PYTHONPATH=/usr/local \
    DATASTORE_DIR="/datastore"

EXPOSE 5000

# The entrypoint script handling PUID/PGID and permissions
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod 777 /app/docker-entrypoint.sh

# The actual flask app
COPY changedetectionio /app/changedetectionio

# The eventlet server wrapper
COPY changedetection.py /app/changedetection.py

WORKDIR /app

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["python", "./changedetection.py", "-d", "/datastore"]
