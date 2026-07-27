import socket
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler

import server


class _BoundedHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        with self.server.counter_lock:
            self.server.active_requests += 1
            self.server.max_active_requests = max(
                self.server.max_active_requests,
                self.server.active_requests,
            )
            if self.server.active_requests == 2:
                self.server.capacity_reached.set()
        try:
            self.server.release_requests.wait(timeout=3)
            body = b"OK"
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)
        finally:
            with self.server.counter_lock:
                self.server.active_requests -= 1

    def log_message(self, _format, *_args):
        return


class _FailOnceHandler:
    def __init__(self, request, _client_address, server_instance):
        request.recv(4096)
        if not server_instance.failed_once:
            server_instance.failed_once = True
            raise RuntimeError("synthetic handler failure")
        response = b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK"
        request.sendall(response)


class ResourceGuardServerTest(unittest.TestCase):
    def _start(self, handler, **kwargs):
        httpd = server.ERPThreadingHTTPServer(("127.0.0.1", 0), handler, **kwargs)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(httpd.server_close)
        self.addCleanup(thread.join, 2)
        self.addCleanup(httpd.shutdown)
        return httpd

    def test_default_limit_is_sixteen_and_excess_is_rejected(self):
        httpd = self._start(
            _BoundedHandler,
            max_request_threads=2,
            admission_timeout_seconds=0.05,
        )
        self.assertEqual(server.ERPThreadingHTTPServer.__init__.__kwdefaults__["max_request_threads"], 16)
        httpd.counter_lock = threading.Lock()
        httpd.active_requests = 0
        httpd.max_active_requests = 0
        httpd.capacity_reached = threading.Event()
        httpd.release_requests = threading.Event()
        url = f"http://127.0.0.1:{httpd.server_port}/"
        results = []

        def request():
            with urllib.request.urlopen(url, timeout=3) as response:
                results.append((response.status, response.read()))

        clients = [threading.Thread(target=request) for _ in range(2)]
        for client in clients:
            client.start()
        self.assertTrue(httpd.capacity_reached.wait(timeout=2))
        started = time.monotonic()
        with self.assertRaises(urllib.error.HTTPError) as rejected:
            urllib.request.urlopen(url, timeout=2)
        self.assertEqual(rejected.exception.code, 503)
        self.assertEqual(rejected.exception.headers.get("Retry-After"), "1")
        self.assertEqual(
            rejected.exception.read(),
            '{"error":"服务器繁忙，请稍后重试","code":"SERVER_BUSY"}'.encode("utf-8"),
        )
        self.assertLess(time.monotonic() - started, 1)
        httpd.release_requests.set()
        for client in clients:
            client.join(timeout=2)
        self.assertEqual(httpd.max_active_requests, 2)
        self.assertEqual(results, [(200, b"OK"), (200, b"OK")])

    def test_handler_exception_releases_capacity_slot(self):
        httpd = self._start(
            _FailOnceHandler,
            max_request_threads=1,
            admission_timeout_seconds=0.1,
        )
        httpd.failed_once = False
        httpd.handle_error = lambda *_args: None

        def raw_request():
            with socket.create_connection(("127.0.0.1", httpd.server_port), timeout=2) as client:
                client.sendall(b"GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
                return client.recv(4096)

        self.assertEqual(raw_request(), b"")
        for _ in range(20):
            response = raw_request()
            if b"200 OK" in response:
                break
            time.sleep(0.01)
        self.assertIn(b"200 OK", response)


if __name__ == "__main__":
    unittest.main()
