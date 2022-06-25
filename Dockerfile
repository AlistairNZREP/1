# pip dependencies install stage
FROM python:3.8-slim as builder

# rustc compiler would be needed on ARM type devices but theres an issue with some deps not building..
ARG CRYPTOGRAPHY_DONT_BUILD_RUST=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    libssl-dev \
    libffi-dev \
    gcc \
    libc-dev \
    libxslt-dev \
    zlib1g-dev \
    g++

RUN mkdir /install
WORKDIR /install

COPY requirements.txt /requirements.txt

RUN pip install --target=/dependencies -r /requirements.txt

# Playwright is an alternative to Selenium
# Excluded this package from requirements.txt to prevent arm/v6 and arm/v7 builds from failing
RUN pip install --target=/dependencies playwright~=1.20 \
    || echo "WARN: Failed to install Playwright. The application can still run, but the Playwright option will be disabled."

# Final image stage
FROM python:3.8-slim

# Actual packages needed at runtime, usually due to the notification (apprise) backend
# rustc compiler would be needed on ARM type devices but theres an issue with some deps not building..
ARG CRYPTOGRAPHY_DONT_BUILD_RUST=1

# Re #93, #73, excluding rustc (adds another 430Mb~)
RUN set -ex; \
    apt-get update && apt-get install -y --no-install-recommends \
        g++ \
        gcc \
        gosu \
        libc-dev \
        libffi-dev \
        libssl-dev \
        libxslt-dev \
        zlib1g-dev && \
    rm -rf /var/lib/apt/lists/*; \
    useradd -u 911 -U -d /datastore -s /bin/false abc && \
    usermod -G users abc; \
    mkdir -p /datastore

# https://stackoverflow.com/questions/58701233/docker-logs-erroneously-appears-empty-until-container-stops
ENV PYTHONUNBUFFERED=1

# Re #80, sets SECLEVEL=1 in openssl.conf to allow monitoring sites with weak/old cipher suites
RUN sed -i 's/^CipherString = .*/CipherString = DEFAULT@SECLEVEL=1/' /etc/ssl/openssl.cnf

# Copy modules over to the final image and add their dir to PYTHONPATH
COPY --from=builder /dependencies /usr/local
ENV PYTHONPATH=/usr/local

EXPOSE 5000

# The entrypoint script handling PUID/PGID and permissions
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod u+x /app/docker-entrypoint.sh

# The actual flask app
COPY changedetectionio /app/changedetectionio
# The eventlet server wrapper
COPY changedetection.py /app/changedetection.py

WORKDIR /app

CMD ["/app/docker-entrypoint.sh"]
