/* eslint-disable max-classes-per-file */
/* eslint-disable no-restricted-globals */
/* eslint-disable no-undef */
$(document).ready(() => {
  // if deployed to a site supporting SSL, use wss://
  const protocol = document.location.protocol.startsWith('https') ? 'wss://' : 'ws://';
  const webSocket = new WebSocket(protocol + location.host);

  // LocalStorage key for persisting data
  const STORAGE_KEY = 'autoglow_device_data';

  // Generate 24-hour labels (00:00 to 23:00)
  const hourLabels = [];
  for (let i = 0; i < 24; i++) {
    hourLabels.push(i.toString().padStart(2, '0') + ':00');
  }

  // A class for holding device telemetry data
  class DeviceData {
    constructor(deviceId) {
      this.deviceId = deviceId;
      
      // Initialize 24-hour arrays with 0 values (minutes ON per hour)
      this.onTimeByHour = new Array(24).fill(0);  // Minutes of ON time per hour
      this.energyByHour = new Array(24).fill(null);
      
      // Current status info
      this.status = null;
      this.motionDetected = null;
      
      // Daily totals (accumulates from OFF events)
      this.dailyTotalOnTime = 0;
      this.dailyTotalEnergy = 0;
      this.cumulativeEnergy = 0;
      this.lastResetDate = new Date().toDateString();
      
      // Event log
      this.events = [];
      this.maxEvents = 20;
    }

    // Restore device data from a plain object (from localStorage)
    static fromJSON(data) {
      const device = new DeviceData(data.deviceId);
      device.onTimeByHour = data.onTimeByHour || new Array(24).fill(0);
      device.energyByHour = data.energyByHour || new Array(24).fill(null);
      device.status = data.status;
      device.motionDetected = data.motionDetected;
      device.dailyTotalOnTime = data.dailyTotalOnTime || 0;
      device.dailyTotalEnergy = data.dailyTotalEnergy || 0;
      device.cumulativeEnergy = data.cumulativeEnergy || 0;
      device.lastResetDate = data.lastResetDate || new Date().toDateString();
      device.events = data.events || [];
      return device;
    }

    // Convert to plain object for localStorage
    toJSON() {
      return {
        deviceId: this.deviceId,
        onTimeByHour: this.onTimeByHour,
        energyByHour: this.energyByHour,
        status: this.status,
        motionDetected: this.motionDetected,
        dailyTotalOnTime: this.dailyTotalOnTime,
        dailyTotalEnergy: this.dailyTotalEnergy,
        cumulativeEnergy: this.cumulativeEnergy,
        lastResetDate: this.lastResetDate,
        events: this.events
      };
    }

    addData(time, payload) {
      // Check if we need to reset daily totals (new day)
      const today = new Date().toDateString();
      if (this.lastResetDate !== today) {
        this.dailyTotalOnTime = 0;
        this.dailyTotalEnergy = 0;
        this.cumulativeEnergy = 0;
        this.onTimeByHour = new Array(24).fill(0);
        this.energyByHour = new Array(24).fill(null);
        this.lastResetDate = today;
      }

      // Get the hour from the timestamp
      const date = new Date(time);
      const hour = date.getHours();
      
      if (payload.status === 'ON') {
        this.motionDetected = payload.motionDetected;
        // Log ON event
        this.addEvent(time, 'ON', `Motion: ${payload.motionDetected ? 'Yes' : 'No'}, Light: ${payload.lightLevelPercent}%`);
      } else if (payload.status === 'OFF') {
        // Accumulate daily totals from OFF events
        if (payload.totalOnTime_s) {
          this.dailyTotalOnTime += payload.totalOnTime_s;
          // Add ON time to the current hour (convert seconds to minutes)
          const onTimeMinutes = payload.totalOnTime_s / 60;
          this.onTimeByHour[hour] += onTimeMinutes;
          // Cap at 60 minutes per hour
          if (this.onTimeByHour[hour] > 60) {
            this.onTimeByHour[hour] = 60;
          }
        }
        if (payload.totalEnergyConsumed_J) {
          this.dailyTotalEnergy += payload.totalEnergyConsumed_J;
          this.cumulativeEnergy += payload.totalEnergyConsumed_J;
        }
        // Log OFF event
        this.addEvent(time, 'OFF', `Duration: ${payload.totalOnTime_s?.toFixed(2) || 0}s, Energy: ${payload.totalEnergyConsumed_J?.toFixed(6) || 0}J`);
      }

      this.status = payload.status;

      // Update energy by hour
      this.energyByHour[hour] = this.cumulativeEnergy;
      
      // Fill in energy values for earlier hours if they're null (carry forward)
      for (let i = 0; i < hour; i++) {
        if (this.energyByHour[i] === null) {
          this.energyByHour[i] = 0;
        }
      }
    }

    addEvent(time, status, details) {
      const timeStr = new Date(time).toLocaleTimeString();
      this.events.unshift({ time: timeStr, status, details });
      if (this.events.length > this.maxEvents) {
        this.events.pop();
      }
    }
  }

  // All the devices in the list
  class TrackedDevices {
    constructor() {
      this.devices = [];
    }

    findDevice(deviceId) {
      for (let i = 0; i < this.devices.length; ++i) {
        if (this.devices[i].deviceId === deviceId) {
          return this.devices[i];
        }
      }
      return undefined;
    }

    getDevicesCount() {
      return this.devices.length;
    }

    // Save all devices to localStorage
    saveToStorage() {
      try {
        const data = this.devices.map(device => device.toJSON());
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        console.log('Data saved to localStorage');
      } catch (e) {
        console.error('Failed to save to localStorage:', e);
      }
    }

    // Load devices from localStorage
    loadFromStorage() {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const data = JSON.parse(stored);
          this.devices = data.map(d => DeviceData.fromJSON(d));
          console.log(`Loaded ${this.devices.length} device(s) from localStorage`);
          return true;
        }
      } catch (e) {
        console.error('Failed to load from localStorage:', e);
      }
      return false;
    }
  }

  const trackedDevices = new TrackedDevices();

  // ============ DAILY TAB CHARTS ============
  
  // Light ON Time Bar Chart - 24 hour x-axis, y-axis 0-60 minutes
  const lightOnTimeChartData = {
    labels: hourLabels,
    datasets: [
      // Bar chart data for ON time per hour
      {
        type: 'bar',
        label: 'Light On Time (min)',
        backgroundColor: 'rgba(0, 230, 118, 0.7)',
        borderColor: 'rgba(0, 230, 118, 1)',
        borderWidth: 2,
        data: new Array(24).fill(0),
        order: 2
      },
      // Reference line at 15 min
      {
        type: 'line',
        label: '15 min',
        borderColor: 'rgba(255, 255, 255, 0.3)',
        borderWidth: 1,
        borderDash: [5, 5],
        pointRadius: 0,
        fill: false,
        data: new Array(24).fill(15),
        order: 1
      },
      // Reference line at 30 min
      {
        type: 'line',
        label: '30 min',
        borderColor: 'rgba(255, 255, 255, 0.4)',
        borderWidth: 1,
        borderDash: [5, 5],
        pointRadius: 0,
        fill: false,
        data: new Array(24).fill(30),
        order: 1
      },
      // Reference line at 45 min
      {
        type: 'line',
        label: '45 min',
        borderColor: 'rgba(255, 255, 255, 0.5)',
        borderWidth: 1,
        borderDash: [5, 5],
        pointRadius: 0,
        fill: false,
        data: new Array(24).fill(45),
        order: 1
      },
      // Reference line at 60 min
      {
        type: 'line',
        label: '60 min',
        borderColor: 'rgba(255, 255, 255, 0.6)',
        borderWidth: 2,
        borderDash: [5, 5],
        pointRadius: 0,
        fill: false,
        data: new Array(24).fill(60),
        order: 1
      }
    ]
  };

  const lightOnTimeChartOptions = {
    maintainAspectRatio: true,
    responsive: true,
    scales: {
      yAxes: [{
        ticks: {
          min: 0,
          max: 60,
          stepSize: 15,
          callback: function(value) {
            return value + ' min';
          }
        },
        scaleLabel: {
          display: true,
          labelString: 'Minutes On'
        },
        gridLines: {
          color: 'rgba(255, 255, 255, 0.1)'
        }
      }],
      xAxes: [{
        scaleLabel: {
          display: true,
          labelString: 'Hour'
        },
        ticks: {
          maxRotation: 45,
          minRotation: 45
        },
        gridLines: {
          color: 'rgba(255, 255, 255, 0.1)'
        }
      }]
    },
    legend: {
      display: false
    },
    tooltips: {
      callbacks: {
        label: function(tooltipItem, data) {
          if (tooltipItem.datasetIndex === 0) {
            return tooltipItem.yLabel.toFixed(2) + ' min';
          }
          return null;
        }
      },
      filter: function(tooltipItem) {
        return tooltipItem.datasetIndex === 0;
      }
    }
  };

  const lightOnTimeCtx = document.getElementById('lightStatusChart').getContext('2d');
  const lightOnTimeChart = new Chart(lightOnTimeCtx, {
    type: 'bar',
    data: lightOnTimeChartData,
    options: lightOnTimeChartOptions,
  });

  // Energy Consumed Chart - 24 hour x-axis
  const energyChartData = {
    labels: hourLabels,
    datasets: [{
      fill: true,
      label: 'Cumulative Energy (J)',
      borderColor: 'rgba(255, 193, 7, 1)',
      backgroundColor: 'rgba(255, 193, 7, 0.2)',
      pointBackgroundColor: 'rgba(255, 193, 7, 1)',
      pointBorderColor: 'rgba(255, 193, 7, 1)',
      pointRadius: 3,
      pointHoverRadius: 5,
      spanGaps: true,
      data: new Array(24).fill(null)
    }]
  };

  const energyChartOptions = {
    maintainAspectRatio: true,
    responsive: true,
    scales: {
      yAxes: [{
        ticks: {
          beginAtZero: true
        },
        scaleLabel: {
          display: true,
          labelString: 'Joules'
        },
        gridLines: {
          color: 'rgba(255, 255, 255, 0.1)'
        }
      }],
      xAxes: [{
        scaleLabel: {
          display: true,
          labelString: 'Hour'
        },
        ticks: {
          maxRotation: 45,
          minRotation: 45
        },
        gridLines: {
          color: 'rgba(255, 255, 255, 0.1)'
        }
      }]
    },
    legend: {
      display: false
    }
  };

  const energyCtx = document.getElementById('energyChart').getContext('2d');
  const energyChart = new Chart(energyCtx, {
    type: 'line',
    data: energyChartData,
    options: energyChartOptions,
  });

  // ============ WEEKLY TAB CHARTS ============
  // Dummy data for the week
  const daysOfWeek = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  
  // Dummy data: Light on time in seconds per day
  const weeklyOnTimeData = [1845, 2340, 1560, 2890, 2100, 3200, 1980];
  
  // Dummy data: Energy consumed in Joules per day
  const weeklyEnergyData = [45.23, 58.12, 38.45, 72.34, 52.67, 81.90, 49.56];

  // Helper function to format seconds as hours and minutes for axis labels
  function formatSecondsToHM(seconds) {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${mins}m`;
    }
    return `${mins}m`;
  }

  // Weekly On Time Bar Chart
  const weeklyOnTimeCtx = document.getElementById('weeklyOnTimeChart').getContext('2d');
  const weeklyOnTimeChart = new Chart(weeklyOnTimeCtx, {
    type: 'bar',
    data: {
      labels: daysOfWeek,
      datasets: [{
        label: 'Light On Time',
        data: weeklyOnTimeData,
        backgroundColor: 'rgba(255, 193, 7, 0.7)',
        borderColor: 'rgba(255, 193, 7, 1)',
        borderWidth: 2,
        borderRadius: 4,
      }]
    },
    options: {
      maintainAspectRatio: true,
      responsive: true,
      scales: {
        yAxes: [{
          ticks: {
            beginAtZero: true,
            callback: function(value) {
              return formatSecondsToHM(value);
            }
          },
          scaleLabel: {
            display: true,
            labelString: 'Time (h:m)'
          },
          gridLines: {
            color: 'rgba(255, 255, 255, 0.1)'
          }
        }],
        xAxes: [{
          gridLines: {
            color: 'rgba(255, 255, 255, 0.1)'
          }
        }]
      },
      legend: {
        display: false
      },
      tooltips: {
        callbacks: {
          label: function(tooltipItem) {
            return formatSecondsToHM(tooltipItem.yLabel);
          }
        }
      }
    }
  });

  // Weekly Energy Bar Chart
  const weeklyEnergyCtx = document.getElementById('weeklyEnergyChart').getContext('2d');
  const weeklyEnergyChart = new Chart(weeklyEnergyCtx, {
    type: 'bar',
    data: {
      labels: daysOfWeek,
      datasets: [{
        label: 'Energy Consumed (Joules)',
        data: weeklyEnergyData,
        backgroundColor: 'rgba(0, 200, 150, 0.7)',
        borderColor: 'rgba(0, 200, 150, 1)',
        borderWidth: 2,
        borderRadius: 4,
      }]
    },
    options: {
      maintainAspectRatio: true,
      responsive: true,
      scales: {
        yAxes: [{
          ticks: {
            beginAtZero: true
          },
          scaleLabel: {
            display: true,
            labelString: 'Joules'
          },
          gridLines: {
            color: 'rgba(255, 255, 255, 0.1)'
          }
        }],
        xAxes: [{
          gridLines: {
            color: 'rgba(255, 255, 255, 0.1)'
          }
        }]
      },
      legend: {
        display: false
      }
    }
  });

  // Calculate and display weekly averages
  function updateWeeklyAverages() {
    const avgOnTime = weeklyOnTimeData.reduce((a, b) => a + b, 0) / weeklyOnTimeData.length;
    const avgEnergy = weeklyEnergyData.reduce((a, b) => a + b, 0) / weeklyEnergyData.length;
    
    document.getElementById('weeklyAvgOnTime').innerText = formatTime(avgOnTime);
    document.getElementById('weeklyAvgEnergy').innerText = avgEnergy.toFixed(2) + ' J';
  }

  // Format seconds to readable time
  function formatTime(seconds) {
    if (seconds < 60) {
      return seconds.toFixed(2) + ' s';
    } else if (seconds < 3600) {
      const mins = Math.floor(seconds / 60);
      const secs = (seconds % 60).toFixed(0);
      return `${mins}m ${secs}s`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      return `${hours}h ${mins}m`;
    }
  }

  // Initialize weekly averages
  updateWeeklyAverages();

  // ============ TAB SWITCHING ============
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabContents = document.querySelectorAll('.tab-content');

  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const tabName = button.getAttribute('data-tab');
      
      // Update button states
      tabButtons.forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');
      
      // Update content visibility
      tabContents.forEach(content => content.classList.remove('active'));
      document.getElementById(`${tabName}-tab`).classList.add('active');
      
      // Resize charts when tab becomes visible
      if (tabName === 'weekly') {
        weeklyOnTimeChart.resize();
        weeklyEnergyChart.resize();
      } else {
        lightOnTimeChart.resize();
        energyChart.resize();
      }
    });
  });

  // ============ UI ELEMENTS ============
  let needsAutoSelect = true;
  const deviceCount = document.getElementById('deviceCount');
  const listOfDevices = document.getElementById('listOfDevices');

  // Status panel elements
  const lightIndicatorEl = document.getElementById('lightIndicator');
  const motionStatusEl = document.getElementById('motionStatus');
  const dailyOnTimeEl = document.getElementById('dailyOnTime');
  const dailyEnergyEl = document.getElementById('dailyEnergy');
  const eventListEl = document.getElementById('eventList');

  function updateStatusPanel(device) {
    if (!device) return;
    
    // Update light indicator
    if (device.status !== null) {
      if (device.status === 'ON') {
        lightIndicatorEl.classList.remove('off');
        lightIndicatorEl.classList.add('on');
      } else {
        lightIndicatorEl.classList.remove('on');
        lightIndicatorEl.classList.add('off');
      }
    }
    
    // Update motion status
    if (device.motionDetected !== null) {
      motionStatusEl.innerText = device.motionDetected ? 'Detected' : 'None';
      motionStatusEl.className = 'status-value ' + (device.motionDetected ? 'motion-detected' : '');
    }
    
    // Update daily totals
    dailyOnTimeEl.innerText = formatTime(device.dailyTotalOnTime);
    dailyEnergyEl.innerText = device.dailyTotalEnergy.toFixed(6) + ' J';
    
    // Update event log
    updateEventLog(device);
  }

  function updateEventLog(device) {
    if (!device) return;
    
    eventListEl.innerHTML = '';
    device.events.forEach(event => {
      const eventDiv = document.createElement('div');
      eventDiv.className = `event-item event-${event.status.toLowerCase()}`;
      eventDiv.innerHTML = `
        <span class="event-time">${event.time}</span>
        <span class="event-status">${event.status}</span>
        <span class="event-details">${event.details}</span>
      `;
      eventListEl.appendChild(eventDiv);
    });
  }

  function updateDailyCharts(device) {
    if (!device) return;
    
    // Update light on time bar chart with 24-hour data
    lightOnTimeChartData.datasets[0].data = device.onTimeByHour;
    lightOnTimeChart.update();
    
    // Update energy chart with 24-hour data
    energyChartData.datasets[0].data = device.energyByHour;
    energyChart.update();
  }

  function OnSelectionChange() {
    if (listOfDevices.selectedIndex < 0) return;
    const device = trackedDevices.findDevice(listOfDevices[listOfDevices.selectedIndex].text);
    if (device) {
      updateDailyCharts(device);
      updateStatusPanel(device);
    }
  }
  listOfDevices.addEventListener('change', OnSelectionChange, false);

  // ============ RESTORE FROM LOCAL STORAGE ============
  function restoreFromStorage() {
    if (trackedDevices.loadFromStorage()) {
      // Check if we need to reset data for a new day
      const today = new Date().toDateString();
      trackedDevices.devices.forEach(device => {
        if (device.lastResetDate !== today) {
          console.log(`Resetting data for device ${device.deviceId} (new day)`);
          device.dailyTotalOnTime = 0;
          device.dailyTotalEnergy = 0;
          device.cumulativeEnergy = 0;
          device.onTimeByHour = new Array(24).fill(0);
          device.energyByHour = new Array(24).fill(null);
          device.lastResetDate = today;
        }
      });

      // Restore UI for loaded devices
      const numDevices = trackedDevices.getDevicesCount();
      if (numDevices > 0) {
        deviceCount.innerText = numDevices === 1 ? `${numDevices} device` : `${numDevices} devices`;
        
        // Add devices to the dropdown
        trackedDevices.devices.forEach(device => {
          const node = document.createElement('option');
          const nodeText = document.createTextNode(device.deviceId);
          node.appendChild(nodeText);
          listOfDevices.appendChild(node);
        });

        // Auto-select first device and update UI
        needsAutoSelect = false;
        listOfDevices.selectedIndex = 0;
        OnSelectionChange();
        
        // Save after potential reset
        trackedDevices.saveToStorage();
        
        console.log('UI restored from localStorage');
      }
    }
  }

  // Restore data on page load
  restoreFromStorage();

  // ============ WEBSOCKET MESSAGE HANDLER ============
  webSocket.onmessage = function onMessage(message) {
    try {
      const messageData = JSON.parse(message.data);
      console.log(messageData);

      // Extract payload
      const payload = messageData.IotData;

      // Validate we have the expected data
      if (!messageData.MessageDate || !payload || !payload.status) {
        return;
      }

      // Find or add device to list of tracked devices
      const existingDeviceData = trackedDevices.findDevice(messageData.DeviceId);

      if (existingDeviceData) {
        existingDeviceData.addData(messageData.MessageDate, payload);
      } else {
        const newDeviceData = new DeviceData(messageData.DeviceId);
        trackedDevices.devices.push(newDeviceData);
        const numDevices = trackedDevices.getDevicesCount();
        deviceCount.innerText = numDevices === 1 ? `${numDevices} device` : `${numDevices} devices`;
        newDeviceData.addData(messageData.MessageDate, payload);

        // Add device to the UI list
        const node = document.createElement('option');
        const nodeText = document.createTextNode(messageData.DeviceId);
        node.appendChild(nodeText);
        listOfDevices.appendChild(node);

        // If this is the first device, auto-select it
        if (needsAutoSelect) {
          needsAutoSelect = false;
          listOfDevices.selectedIndex = 0;
          OnSelectionChange();
        }
      }

      // Save to localStorage after each update
      trackedDevices.saveToStorage();

      // Update UI for currently selected device
      const selectedDevice = trackedDevices.findDevice(listOfDevices[listOfDevices.selectedIndex]?.text);
      if (selectedDevice && selectedDevice.deviceId === messageData.DeviceId) {
        updateStatusPanel(selectedDevice);
        updateDailyCharts(selectedDevice);
      }
    } catch (err) {
      console.error(err);
    }
  };
});
