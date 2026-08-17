FROM ubuntu:20.04

ARG DEBIAN_FRONTEND=noninteractive
ARG TEXLIVE_ONDEMAND_REF=cc2146e220658f5ee0f8643355252ae0995fbc98

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      git \
      build-essential \
      python3 \
      python3-dev \
      python3-pip \
      libkpathsea-dev \
      texlive-full \
    && rm -rf /var/lib/apt/lists/*

RUN git init /opt/texlive-ondemand \
    && git -C /opt/texlive-ondemand remote add origin https://github.com/SwiftLaTeX/Texlive-Ondemand.git \
    && git -C /opt/texlive-ondemand fetch --depth 1 origin "${TEXLIVE_ONDEMAND_REF}" \
    && git -C /opt/texlive-ondemand checkout --detach FETCH_HEAD

WORKDIR /opt/texlive-ondemand

RUN python3 kpathsea_pdftex_setup.py build_ext --inplace \
    && python3 kpathsea_xetex_setup.py build_ext --inplace \
    && pip3 install --no-cache-dir -r requirements.txt

EXPOSE 5001

# The upstream app has no dedicated health route; article.cls is a cheap
# kpathsea probe on the same endpoint used by the PdfTeX worker.
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5001/pdftex/25/article.cls', timeout=5).read(1)"

CMD ["python3", "wsgi.py"]
