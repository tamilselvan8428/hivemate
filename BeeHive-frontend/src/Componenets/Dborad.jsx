import React, { useEffect, useState } from "react";
import Navbar from "./Navbar";
import { motion } from "framer-motion";
import axios from "axios";
import { ledAPI, apiKeyAPI } from "../api";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';




const weatherFor = (key) => {
  const k = (key || "").toLowerCase();
  if (/rain|drizzle/.test(k)) return { icon: "🌧️", text: "Rainy" };
  if (/cloud|mist/.test(k)) return { icon: "☁️", text: "Cloudy" };
  if (/clear/.test(k)) return { icon: "☀️", text: "Clear" };
  return { icon: "🌤️", text: "Sunny" };
};


const Dborad = () => {
  const [hives, setHives] = useState([]);
  const [hiveHistory, setHiveHistory] = useState([]);
  const [heaters, setHeaters] = useState({});
  const [weather, setWeather] = useState({
    temp: 25,
    humidity: 60,
    pressure: 1013,
    wind: 0,
    climate: "Sunny",
  });
  const [time, setTime] = useState(new Date());
  const [lastWeatherUpdated, setLastWeatherUpdated] = useState(null);
  const farmId = localStorage.getItem("farmId");
  console.log("Farm ID in Dashboard:", farmId);
  
  const OPENWEATHER_KEY = import.meta.env.VITE_OPENWEATHER_KEY || '8e88a178b6f8d7c81283a7bf200969fa';
  const THINGSPEAK_KEY = import.meta.env.VITE_THINGSPEAK_KEY || 'C4SNIR7EP4W21360';
  const THINGSPEAK_WRITE_KEY = import.meta.env.VITE_THINGSPEAK_WRITE_KEY || 'A0B9TJ5N4L8R72ZE';

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

const fetchWeather = async () => {
  if (!OPENWEATHER_KEY) {
    console.warn("VITE_OPENWEATHER_KEY is not set. Weather fetch skipped.");
    return;
  }

  if (!navigator.geolocation) {
    console.error("Geolocation not supported");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude: lat, longitude: lon } = pos.coords;
      try {
        const res = await fetch(
          `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=8e88a178b6f8d7c81283a7bf200969fa`
        );
        const data = await res.json();

        if (res.status !== 200 || data.cod !== 200) {
          console.error("Weather API Error:", data);
          return;
        }

        setWeather({
          temp: Math.round(data.main.temp),
          humidity: data.main.humidity,
          pressure: data.main.pressure,
          wind: Math.round(data.wind?.speed || 0),
          climate: data.weather?.[0]?.main || "Unknown",
        });
        setLastWeatherUpdated(new Date());
      } catch (err) {
        console.error("Error fetching weather:", err);
      }
    },
    (error) => {
      console.error("Geolocation error:", error);
      // keep UI friendly but don't spam alerts repeatedly
      // alert("Please enable location permission to fetch weather details.");
    },
    { enableHighAccuracy: true, maximumAge: 60000, timeout: 10000 }
  );
};

  // 🔹 Send API key to backend
 const sendApiKey = async (farmId, apiKey) => {

    farmId = localStorage.getItem("farmId");
  if (!farmId || !apiKey) {
    alert("farmId or apiKey is missing!");
    return;
  }
  

  try {
    const res = await apiKeyAPI.saveKey({
      farmId: Number(farmId), 
      apiKey
    });
    alert("API key saved successfully!");
    console.log(res.data);
  } catch (err) {
    console.error(err.response?.data || err);
    alert("Error saving API key");
  }
};

  
  const fetchHives = async () => {
    try {
      // 1. Fetch recent feeds (results=10) to get both latest sensors and latest burner state
      const resLatest = await fetch(
        `https://api.thingspeak.com/channels/3126283/feeds.json?api_key=${THINGSPEAK_KEY}&results=10`
      );
      const dataLatest = await resLatest.json();

      if (dataLatest && Array.isArray(dataLatest.feeds) && dataLatest.feeds.length > 0) {
        const feeds = dataLatest.feeds;

        // A. Find latest burner state (from any recent entry that has field6)
        const latestBurnerEntry = [...feeds].reverse().find(
          (f) => f.field6 !== null && f.field6 !== undefined && f.field6 !== ""
        );
        if (latestBurnerEntry) {
          const isBurnerOn = latestBurnerEntry.field6 === "1" || latestBurnerEntry.field6 === 1;
          setHeaters((prev) => ({ ...prev, 1: isBurnerOn }));
        }

        // B. Find latest sensor telemetry (from the most recent entry with temp or humidity)
        const latestSensorEntry =
          [...feeds].reverse().find((f) => f.field2 != null || f.field3 != null) ||
          feeds[feeds.length - 1];

        const lastUpdateTime = new Date(latestSensorEntry.created_at);
        const now = new Date();
        const diffMin = (now - lastUpdateTime) / 60000; // minutes

        const hiveData = [
          {
            id: 1,
            temp: latestSensorEntry.field2 != null ? parseFloat(latestSensorEntry.field2) : 0,
            humidity: latestSensorEntry.field3 != null ? parseFloat(latestSensorEntry.field3) : 0,
            ph: latestSensorEntry.field4 != null ? parseFloat(latestSensorEntry.field4) : 0,
            weight: latestSensorEntry.field5 != null ? parseFloat(latestSensorEntry.field5) : 0,
            live: diffMin < 5, // online if updated within last 5 minutes
          },
        ];
        setHives(hiveData);
      } else {
        setHives([]);
      }

      // 2. Fetch 30-minute average data for the historical graph
      const resHistory = await fetch(
        `https://api.thingspeak.com/channels/3126283/feeds.json?api_key=${THINGSPEAK_KEY}&results=100&average=30`
      );
      const dataHistory = await resHistory.json();

      if (dataHistory && Array.isArray(dataHistory.feeds) && dataHistory.feeds.length > 0) {
        const history = dataHistory.feeds
          .filter(f => f.field2 != null || f.field3 != null || f.field4 != null)
          .map(f => ({
            time: new Date(f.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            temp: f.field2 ? parseFloat(f.field2) : null,
            humidity: f.field3 ? parseFloat(f.field3) : null,
            ph: f.field4 ? parseFloat(f.field4) : null
          }));
        setHiveHistory(history);
      } else {
        setHiveHistory([]);
      }

    } catch (err) {
      console.error("Error fetching hive data:", err);
      setHives([]);
      setHiveHistory([]);
    }
  };

 
  useEffect(() => {
    fetchWeather();
    fetchHives();

    const hivesInterval = setInterval(fetchHives, 5000); // sync hive data & burner state every 5 sec
    const weatherInterval = setInterval(fetchWeather, 300000); // every 5 min

    return () => {
      clearInterval(hivesInterval);
      clearInterval(weatherInterval);
    };
  }, []);

  // 🔹 Calculate overall hive health
  const avgPh =
    hives.length > 0
      ? hives.reduce((s, h) => s + (h.ph || 0), 0) / hives.length
      : 0;

  const idealTemp = 35;
  const idealHumidity = 65;

  const tempScore = Math.min(100, Math.abs((weather.temp - idealTemp) / 10) * 100);
  const humidityScore = Math.min(100, Math.abs((weather.humidity - idealHumidity) / 35) * 100);
  const phScore = Math.min(100, Math.abs((avgPh - 6.8) / 1.5) * 100);
  const urgency = Math.round(tempScore * 0.5 + humidityScore * 0.3 + phScore * 0.2);

  const gaugeColor = urgency > 60 ? "bg-red-500" : urgency > 30 ? "bg-yellow-400" : "bg-green-500";

  const toggleHeater = async (id) => {
    console.log("Toggling burner for hive ID:", id);
    const nextVal = heaters[id] ? 0 : 1;
    const currentHive = hives.find((h) => h.id === id);

    let updateUrl = `https://api.thingspeak.com/update?api_key=${THINGSPEAK_WRITE_KEY}&field6=${nextVal}`;
    if (currentHive && currentHive.temp > 0) {
      updateUrl += `&field1=1&field2=${currentHive.temp}&field3=${currentHive.humidity}&field4=${currentHive.ph}&field5=${currentHive.weight}`;
    }

    try {
      const res = await fetch(updateUrl);
      const data = await res.text();
      if (data.trim() === "0") {
        alert("ThingSpeak rate limit: Please wait 15 seconds before toggling the burner again.");
        return;
      }
      setHeaters((prev) => ({ ...prev, [id]: nextVal === 1 }));
    } catch (err) {
      console.error("Error toggling burner on ThingSpeak:", err);
      alert("Failed to toggle burner on ThingSpeak. Check connection.");
    }
  };

  const addHive = () => {
    const newHive = {
      id: hives.length + 1,
      temp: 0,
      humidity: 0,
      ph: 0,
      weight: 0,
      live: false,
    };
    setHives((prev) => [...prev, newHive]);
  };

 
  const Gauge = ({ value = 0, size = 140, stroke = 12 }) => {
    const radius = (size - stroke) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (value / 100) * circumference;
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id="g1" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#33691e" />
            <stop offset="100%" stopColor="#c8e6c9" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="#c8e6c9" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="url(#g1)"
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transform: "rotate(-90deg)", transformOrigin: "50% 50%" }}
        />
        <text x="50%" y="50%" dominantBaseline="middle" textAnchor="middle" fontSize="20" fill="#33691e">
          {value}%
        </text>
      </svg>
    );
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#689f38" }}>
      <Navbar />
      <main className="mt-20 max-w-7xl mx-auto px-6 py-8 text-[#f0f4c3]">
    
        <header className="flex flex-col md:flex-row items-start md:items-center justify-between mb-6 gap-4">
          <div>
            <h1 className="text-4xl font-bold text-[#f0f4c3]">Hive Dashboard 🐝</h1>
            <p className="text-sm text-[#f0f4c3]/80">Overview of hive health and local weather</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="bg-[#558b2f] text-white px-3 py-1.5 rounded-lg text-sm font-semibold shadow" title="Ensure your ESP32 farmId matches this ID">
              Farm ID: {farmId || "Not set"}
            </span>
            <button
              onClick={() => {
                const apiKey = prompt("Enter your API key:");
                if (!apiKey) return;
                sendApiKey(farmId, apiKey);
              }}
              className="bg-[#f0f4c3] text-[#33691e] px-4 py-2 rounded-lg shadow hover:scale-105 transition-transform font-semibold"
            >
              Update key
            </button>
            <button
              onClick={addHive}
              className="bg-[#33691e] text-[#f0f4c3] px-4 py-2 rounded-lg shadow hover:bg-[#2e7d32] transition-transform"
            >
              Add Hive
            </button>
          </div>
        </header>

        {/* WEATHER + SCORE */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {/* Weather Card */}
          <motion.div
            className="col-span-1 h-fit self-center bg-[#f0f4c3] text-[#33691e] rounded-3xl shadow-lg p-6 border border-[#cddc39]"
            whileHover={{ scale: 1.02 }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="text-5xl">{weatherFor(weather.climate).icon}</div>
                <div>
                  <div className="text-3xl font-bold">{weather.temp}°C</div>
                  <div className="text-sm">{weatherFor(weather.climate).text}</div>
                </div>
              </div>
              <div className="text-sm text-gray-600">{time.toLocaleTimeString()}</div>
            </div>

            <div className="mt-2 text-xs text-gray-600">{lastWeatherUpdated ? `Updated: ${lastWeatherUpdated.toLocaleTimeString()}` : "No recent update"}</div>

            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="p-2 bg-[#dcedc8] rounded-lg">
                <div className="text-xs text-[#33691e]">Humidity</div>
                <div className="font-semibold">{weather.humidity}%</div>
              </div>
              <div className="p-2 bg-[#dcedc8] rounded-lg">
                <div className="text-xs text-[#33691e]">Pressure</div>
                <div className="font-semibold">{weather.pressure} hPa</div>
              </div>
              <div className="p-2 bg-[#dcedc8] rounded-lg">
                <div className="text-xs text-[#33691e]">Wind</div>
                <div className="font-semibold">{weather.wind} m/s</div>
              </div>
            </div>
          </motion.div>

          {/* Trend Chart Card */}
          <motion.div
            className="col-span-1 md:col-span-2 bg-[#f0f4c3] text-[#33691e] rounded-3xl shadow-lg p-6 flex flex-col justify-center border border-[#cddc39]"
            whileHover={{ scale: 1.01 }}
          >
            <h3 className="text-xl font-semibold mb-4 text-center md:text-left">Parameter Trends (30-Min Intervals, Last 100 Readings)</h3>
            <div className="w-full h-72 sm:h-80 md:h-96">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={hiveHistory} margin={{ top: 5, right: 10, bottom: 20, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#cddc39" />
                  <XAxis dataKey="time" stroke="#33691e" tick={{fontSize: 10}} minTickGap={30} tickMargin={10} />
                  <YAxis stroke="#33691e" tick={{fontSize: 10}} />
                  <Tooltip contentStyle={{backgroundColor: '#f0f4c3', borderColor: '#cddc39', borderRadius: '8px', fontSize: '12px'}} />
                  <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                  <Line type="monotone" dataKey="temp" stroke="#e53935" name="Temp (°C)" strokeWidth={2} dot={{r: 2}} activeDot={{r: 4}} />
                  <Line type="monotone" dataKey="humidity" stroke="#1e88e5" name="Humidity (%)" strokeWidth={2} dot={{r: 2}} activeDot={{r: 4}} />
                  <Line type="monotone" dataKey="ph" stroke="#8e24aa" name="pH" strokeWidth={2} dot={{r: 2}} activeDot={{r: 4}} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </motion.div>
        </section>

        {/* HIVES */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-semibold text-[#f0f4c3]">Hive Summary</h2>
            <div className="text-sm text-[#f0f4c3]/80">Last updated: {time.toLocaleTimeString()}</div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {hives.length === 0 ? (
              <p className="text-[#f0f4c3]">No hive data available...</p>
            ) : (
              hives.map((h) => (
                <motion.div
                  key={h.id}
                  className={`rounded-2xl p-5 shadow-md border transition-all duration-300 ${
                    h.live ? "bg-[#f0f4c3] border-[#cddc39]" : "bg-gray-200 border-gray-300"
                  }`}
                  whileHover={{ scale: 1.03 }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <div className="text-sm text-[#33691e] font-medium">Hive #{h.id}</div>
                      <div
                        className={`text-2xl font-bold ${
                          h.temp > 37 ? "text-red-600" : "text-[#33691e]"
                        }`}
                      >
                        {h.temp}°C
                      </div>
                    </div>
                    <div
                      className={`w-3 h-3 rounded-full ${
                        h.live ? "bg-green-500" : "bg-red-500"
                      }`}
                      title={h.live ? "Online" : "Offline"}
                    />
                  </div>

                  <div className="text-sm text-[#33691e] space-y-1 mb-3">
                    <div>Humidity: {h.humidity}%</div>
                    <div>pH: {h.ph?.toFixed(2)}</div>
                    <div>
                      Weight: {Number.isFinite(h.weight) ? h.weight.toFixed(2) : "0.00"} kg
                    </div>
                    {!h.live && (
                      <div className="text-red-600 text-xs font-semibold">
                        Device Offline (no update &gt;1 min)
                      </div>
                    )}
                  </div>

                  <div className="mt-2 flex items-center justify-between gap-2">
                    <button
                      onClick={() => toggleHeater(h.id)}
                      className={`px-3 py-1 rounded-full text-sm font-semibold transition ${
                        heaters[h.id]
                          ? "bg-red-500 text-white shadow-md"
                          : "bg-[#33691e] text-[#f0f4c3] hover:bg-[#2e7d32]"
                      }`}
                    >
                      {heaters[h.id] ? "Burner ON" : "Turn On Burner"}
                    </button>
                    <button className="text-sm text-[#558b2f] hover:underline font-medium">
                      Details
                    </button>
                  </div>
                </motion.div>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
};

export default Dborad;