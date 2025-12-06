# AutoGlow

**CS147 Final Project**  
by Khanh Vu and Jeremy Brinas

---

## Overview

This repository contains the web dashboard backend for the AutoGlow project. It connects to Azure IoT Hub to receive real-time data from IoT devices and displays energy consumption and light usage analytics.

## Features

- Real-time light status indicator (ON/OFF)
- Daily view with hourly light-on time and energy consumption graphs
- Weekly view with daily aggregated data (Concept only, not functional)
- Event log tracking ON/OFF events
- Data persistence via localStorage

## Prerequisites

- Node.js
- Azure IoT Hub connection string
- Event Hub consumer group

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set environment variables:
   ```bash
   export IotHubConnectionString="iot-hub-connection-string"
   export EventHubConsumerGroup="consumer-group-name"
   ```

3. Run the application:
   ```bash
   npm start
   ```

4. Open your browser and navigate to `http://localhost:3000`

## Citations

This project was built upon the Microsoft Azure IoT Hub tutorial:

- [Tutorial: Visualize real-time sensor data from your Azure IoT hub in a web application](https://learn.microsoft.com/en-us/azure/iot-hub/iot-hub-live-data-visualization-in-web-apps) - Microsoft Learn


