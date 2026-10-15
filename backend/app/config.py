import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # Anchor coordinates (Default: Yokneam Main Junction)
    CENTER_LAT: float = 32.6595
    CENTER_LON: float = 35.1090
    RADIUS_KM: float = 10.0
    
    # Elevation exaggeration factor
    ELEVATION_SCALE: float = 2.0
    
    # Polling intervals (seconds) - TomTom capped at 1/5min (300s)
    TRAFFIC_POLL_INTERVAL: int = 300
    TRANSIT_POLL_INTERVAL: int = 30
    WEATHER_POLL_INTERVAL: int = 600

    # TomTom API Key from .env (supports both cases)
    TOMTOM_API_KEY: str = ""
    TomTom_API_Key: str = ""

    def get_tomtom_key(self) -> str:
        return self.TomTom_API_Key or self.TOMTOM_API_KEY or os.getenv("TomTom_API_Key", "") or os.getenv("TOMTOM_API_KEY", "")

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()
