import { fetchWeatherApi } from 'openmeteo'
import type { Tool } from 'xsai'

const weatherUrl = 'https://api.open-meteo.com/v1/forecast'
const geocodingUrl = 'https://geocoding-api.open-meteo.com/v1/search'

interface WeatherParams {
  latitude: number
  longitude: number
}

interface WeatherData {
  temperature: number
  weatherCode: number
  cloudCover: number
  windSpeed: number
}

interface GeocodingResponse {
  results: Array<{
    latitude: number
    longitude: number
  }>
}

async function getCoordinates(city: string): Promise<{ latitude: number; longitude: number }> {
  const response = await fetch(`${geocodingUrl}?name=${encodeURIComponent(city)}&count=1`)
  const data = await response.json() as GeocodingResponse
  const location = data.results[0]
  return {
    latitude: location.latitude,
    longitude: location.longitude,
  }
}

async function getWeather(params: WeatherParams): Promise<WeatherData> {
  const apiParams = {
    latitude: params.latitude,
    longitude: params.longitude,
    current: ['temperature_2m', 'rain', 'cloud_cover', 'wind_speed_10m'],
  }

  const responses = await fetchWeatherApi(weatherUrl, apiParams)
  const response = responses[0]

  const current = response.current()!

  return {
    temperature: Math.round(current.variables(0)!.value()),
    weatherCode: current.variables(1)!.value(),
    cloudCover: current.variables(2)!.value(),
    windSpeed: Math.round(current.variables(3)!.value()),
  }
}

export const weatherTool: Tool = {
  type: 'function',
  function: {
    name: 'getWeather',
    description: 'Get current weather data for a location',
    parameters: {
      type: 'object',
      properties: {
        city: {
          type: 'string',
          description: 'The city to get weather for',
        },
      },
      required: ['city'],
    },
  },
  async execute(input: unknown) {
    const { city } = input as { city: string }
    const { latitude, longitude } = await getCoordinates(city)
    const weatherData = await getWeather({ latitude, longitude })
    return weatherData
  },
}
