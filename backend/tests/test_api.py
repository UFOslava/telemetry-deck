import unittest
from fastapi.testclient import TestClient
from app.main import app


class TestBackendAPI(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_health_check(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data.get("status"), "online")

    def test_settings_page(self):
        response = self.client.get("/settings")
        self.assertEqual(response.status_code, 200)
        self.assertIn("text/html", response.headers.get("content-type", ""))
        self.assertIn("Tactical Telemetry Deck - Settings", response.text)

    def test_settings_api_get(self):
        response = self.client.get("/api/settings")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("centerLat", data)
        self.assertIn("centerLon", data)
        self.assertIn("radiusKm", data)
        self.assertIn("initialCameraPitch", data)
        self.assertIn("aaMode", data)
        self.assertIn("cameraRotationSpeed", data)
        self.assertIn("cylinderRotationSpeed", data)
        self.assertIn("issTrackingMode", data)

    def test_iss_satellite_api(self):
        response = self.client.get("/api/satellites/iss")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data.get("norad"), "25544")
        self.assertTrue(data.get("line1", "").startswith("1 25544"))
        self.assertTrue(data.get("line2", "").startswith("2 25544"))

    def test_tomtom_config_api(self):
        response = self.client.get("/api/tomtom-config")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("configured", data)
        self.assertIn("key", data)

    def test_tomtom_search_api(self):
        response = self.client.get("/api/tomtom/search?query=Yokneam")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("results", data)
        self.assertIsInstance(data["results"], list)

    def test_weather_api(self):
        response = self.client.get("/api/weather")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("temperature", data)
        self.assertIn("temp_min", data)
        self.assertIn("temp_max", data)
        self.assertIn("condition", data)
        self.assertIn("icon", data)


if __name__ == "__main__":
    unittest.main()
