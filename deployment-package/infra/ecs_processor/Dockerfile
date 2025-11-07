FROM python:3.11-slim

# Install dependencies
RUN pip install --no-cache-dir boto3

# Set working directory
WORKDIR /app

# Copy processor script
COPY processor.py /app/processor.py

# Run the processor
CMD ["python", "-u", "/app/processor.py"]
