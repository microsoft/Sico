# Copyright (c) 2026 Sico Authors
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.

'''
End-to-end health check script for the Sico platform.

This script provisions a local Sico deployment (either Docker Compose or a
Kind Kubernetes cluster), ensures the Android emulator sandbox is running,
and then exercises the system through its public HTTP/SSE APIs to verify
that the major user-facing flows work end-to-end.

Note: You should install the emulator service through
    ./sandbox/emulator/setup/setup.sh first.
    See sandbox/emulator/README.md for more detail.

Workflow:
    1. (Optional) Tear down any existing Kind cluster and Compose stack,
       then bring up the selected platform via the project Makefile targets
       (``make kind-up`` or ``make compose-up``). Skipped when
       ``--skip-setup`` is passed.
    2. Authenticate as the default operator user by minting a local JWT
       signed with the development secret, and call the chat SSE endpoint
       (``POST /api/sico/conversation/chat``) for a few canned scenarios:
         * ``chat_greetings``       - basic LLM round-trip.
         * ``chat_run_upload``      - web fetch + report generation +
                                      downloadable artifact upload.
         * ``chat_run_android_edge_test`` - sandbox lifecycle and Android
                                      emulator interaction (open Edge,
                                      verify, close, report).
    3. For tool-calling scenarios, fetch the resulting plan via
       ``GET /api/sico/conversation/plan`` and assert that the expected
       built-in tools (e.g. ``webfetch``, ``report``, ``sandbox_acquire``,
       ``run_command``, ``sandbox_release``) were invoked.

A non-zero exit status indicates that one of the assertions failed,
meaning the deployment is not healthy.

Usage:
    python scripts/health.py [--platform docker-compose|kind] [--skip-setup]
'''

import argparse
import time
import json
import os
import subprocess
import jwt
import dotenv
import requests
dotenv.load_dotenv()

def has_key_value_pair(d: dict, key: str, value) -> bool:
    for k, v in d.items():
        if k == key and v == value:
            return True
        if isinstance(v, dict):
            if has_key_value_pair(v, key, value):
                return True
        if isinstance(v, list):
            for item in v:
                if isinstance(item, dict):
                    if has_key_value_pair(item, key, value):
                        return True
    return False

class ChatResult:
    def __init__(self, content: str, turn_id: int):
        self.content = content
        self.turn_id = turn_id

class Health:

    def __init__(self):
        self.find_bash()
        self.retrieved_tokens = {}
        self.endpoint = "localhost:{port}".format(port=os.getenv("SICO_PORT", "8080"))
        self.username = "operator@sico.local"

    def find_bash(self) -> None:
        try:
            subprocess.run(["bash", "--version"], check=True, capture_output=True)
            self.bash = "bash"
            return
        except Exception as e:
            pass

        # where bash
        try:
            bash_path = subprocess.run(["where", "bash"], check=True, capture_output=True, text=True).stdout.strip().splitlines()[0]
            if not os.path.exists(bash_path):
                raise RuntimeError(f"bash not found at path returned by where: {bash_path}")
            self.bash = bash_path
            return
        except Exception as e:
            pass

        raise RuntimeError("bash not found on system")

    def run_in_bash(self, working_directory: str, command: str) -> tuple[str, str]:
        # returns stdout, stderr
        result = subprocess.run([self.bash, "-c", command], cwd=working_directory, capture_output=True, text=True)
        if result.returncode != 0:
            raise subprocess.CalledProcessError(result.returncode, command, output=result.stdout, stderr=result.stderr)
        return result.stdout, result.stderr

    def run_in_bash_redirect(self, working_directory: str, command: str) -> None:
        # runs the command in bash and redirects stdout/stderr to the terminal in real time
        process = subprocess.Popen([self.bash, "-c", command], cwd=working_directory)
        process.communicate()
        if process.returncode != 0:
            raise subprocess.CalledProcessError(process.returncode, command)

    def compose_up(self):
        print("Bringing up Docker Compose services...")
        self.run_in_bash_redirect(".", "make compose-up")
        print("Compose up completed")

    def compose_down(self):
        print("Bringing down Docker Compose services...")
        # remove volumes to ensure no data left
        self.run_in_bash_redirect(".", "docker compose -p sico --env-file .env -f deploy/docker/docker-compose.yaml down -v")
        print("Compose down completed")

    def kind_up(self):
        print("Bringing up Kind cluster...")
        self.run_in_bash_redirect(".", "make kind-up")
        print("Kind cluster up completed")

    def kind_down(self):
        print("Bringing down Kind cluster...")
        self.run_in_bash_redirect(".", "make kind-down")
        print("Kind cluster down completed")

    def emulator_status(self) -> bool:
        out, err = self.run_in_bash(".", "make emulator-status")
        if "is running" in out:
            return True
        return False

    def emulator_start(self):
        self.run_in_bash_redirect(".", "make emulator-start")
        if not self.emulator_status():
            raise RuntimeError("Emulator API service failed to start")
        print("Emulator API service started successfully")

    def emulator_bootstrap(self):
        self.run_in_bash_redirect(".", "make emulator-bootstrap")
        if not self.emulator_status():
            raise RuntimeError("Emulator API service is not running after device bootstrap")
        print("Emulator device bootstrap completed")

    def ensure_emulator_running(self):
        print("Checking if emulator is running...")
        if not self.emulator_status():
            print("Emulator API service is not running. Starting service...")
            self.emulator_start()
        self.emulator_bootstrap()
        print("Emulator API service is running and the default device is bootstrapped")

    def get_token(self, name) -> str:
        if name in self.retrieved_tokens:
            expire_time = self.retrieved_tokens[name].get("expire_time")
            if expire_time and expire_time > int(time.time()):
                return self.retrieved_tokens[name].get("token")

        user_info = json.dumps({"name": name})
        expire_time = int(time.time()) + 3600 # Token expires in 1 hour
        payload = {
            "sub": user_info,
            "exp": expire_time
        }
        token = jwt.encode(payload, "CG24SDVP8OHPK395GB5G", algorithm="HS512")
        self.retrieved_tokens[name] = {"token": token, "expire_time": expire_time}
        return token

    def do_request_sse(self, method: str, route: str, headers: dict = None, body = None) -> requests.Response:
        endpoint = self.endpoint
        url = f"http://{endpoint}/{route.lstrip('/')}"
        token = self.get_token(self.username)
        if headers is None:
            headers = {}
        headers["Authorization"] = f"Bearer {token}"
        headers["Content-Type"] = "application/json"
        if body is not None and not isinstance(body, str):
            body = json.dumps(body)
        response = requests.request(method, url, headers=headers, data=body, stream=True)
        code = response.status_code
        if code < 200 or code >= 300:
            print(f"Request failed with status code {code}: {response.text}")
        response.raise_for_status()
        return response

    def chat(self, agent_instance_id: int, message: str, verbose: bool = True) -> ChatResult:
        body = {
            "agentInstanceId": agent_instance_id,
            "message": message,
        }
        response = self.do_request_sse(
            method="POST",
            route="api/sico/conversation/chat",
            body=body,
        )
        if verbose:
            print("")
            print(f"Chat with Agent Instance {agent_instance_id}, User Message: {message}")
            print("====================")
        result = ChatResult(content="", turn_id=0)
        def append_result(data: str):
            result.content += data
            if verbose:
                print(data, end="", flush=True)
        event = ""
        for chunk in response.iter_lines():
            if chunk:
                line = chunk.decode("utf-8")
                if line.startswith("event:"):
                    event = line[len("event:"):].strip()
                elif line.startswith("data:"):
                    data = line[len("data:"):].strip()
                    if event == "message":
                        try:
                            data = json.loads(data)
                            message_type = data.get("type", 0)
                            turn_id = data.get("turnId", 0)
                            if turn_id > 0:
                                result.turn_id = turn_id

                            if message_type == 1:
                                append_result(data.get("content", "[nocontent]"))

                            elif message_type == 2:
                                content = data.get("content", "null")
                                try:
                                    content = json.loads(content)
                                    workflow_id = content.get("workflow_id", 0)
                                    workflow_execution_id = content.get("workflow_execution_id", 0)
                                    workflow_name = content.get("workflow_name", "")
                                    arguments = content.get("arguments", {})
                                    append_result(f" [tool call: wf={workflow_id}('{workflow_name}') wf-exe={workflow_execution_id} args={json.dumps(arguments)}] \n")

                                except Exception:
                                    append_result(" [invalid type=2 content] ")

                            elif message_type == 6:
                                append_result(f" [error:{data.get('content', '')}] ")

                            elif message_type == 7:
                                content = data.get("content", "null")
                                try:
                                    content = json.loads(content)
                                    title = content.get("title", "")
                                    description = content.get("description", "")
                                    workflow_id = content.get("workflowId", 0)
                                    workflow_execution_id = content.get("workflowExecutionId", 0)
                                    append_result(f" [task summary: title='{title}' desc='{description}' wf={workflow_id} wf-exe={workflow_execution_id}] ")
                                except Exception:
                                    append_result(" [invalid type=7 content] ")

                            elif message_type == 9:
                                # content = data.set("content", "null")
                                append_result(f" [plan] ")
                                # try:
                                #     content = json.loads(content)
                                #     append_result(f" [plan:\n{json.dumps(content, indent=2)}] ")
                                # except Exception:
                                #     append_result(" [invalid type=8 content] ")

                            else:
                                append_result(f" [message type={message_type}] ")

                        except json.JSONDecodeError:
                            append_result(" [JSONDecodeError] ")
                        except Exception as e:
                            append_result(" [error] ")
                    elif event == "keepalive":
                        append_result(" [keepalive] ")
                    elif event == "done":
                        append_result(" [done] ")
                    elif event == "error":
                        append_result(f" [error:{data}] ")
        if verbose:
            print("\n====================")
        return result

    def chat_greetings(self):
        result = self.chat(1, "Hello there! Reply with a 'Hello!' back to me.")
        content = result.content
        if "Hello!" not in content:
            raise RuntimeError("Did not receive expected greeting response from chat")

    def chat_run_python(self):
        result = self.chat(1, "Run a python script that calculates the 15-th term of the Fibonacci sequence. Report the result back to me.")
        content = result.content
        expected = ["610", "[plan]", "[done]"]
        for e in expected:
            if e not in content:
                raise RuntimeError("Did not receive expected Fibonacci calculation result from chat")

    def chat_run_upload(self):
        result = self.chat(1, "Web-fetch the content of www.example.com, write a markdown report and make it downloadable for me.")
        content = result.content
        expected = ["[plan]", "[done]", "http://localhost", "/storage/"]
        for e in expected:
            if e not in content:
                raise RuntimeError("Did not receive expected upload result from chat")
        plan = self.get_plan(1, result.turn_id)
        expected = [
            ("builtinToolName", "webfetch"),
            ("builtinToolName", "report"),
        ]
        for key, value in expected:
            if not has_key_value_pair(plan, key, value):
                raise RuntimeError(f"Did not find expected key-value pair ({key}, {value}) in plan")

    def chat_run_android_edge_test(self):
        result = self.chat(2, "In the android emulator: open Edge; verify Edge interface appears; close it. Output the testing result to a downloadable markdown report.")
        content = result.content
        expected = ["[plan]", "[done]", "http://localhost", "/storage/"]
        for e in expected:
            if e not in content:
                raise RuntimeError("Did not receive expected android Edge test result from chat")
        plan = self.get_plan(2, result.turn_id)
        expected = [
            ("builtinToolName", "sandbox_preview"),
            ("builtinToolName", "sandbox_acquire"),
            ("builtinToolName", "run_command"),
            ("builtinToolName", "sandbox_reset"),
            ("builtinToolName", "report"),
            ("builtinToolName", "sandbox_release"),
        ]
        for key, value in expected:
            if not has_key_value_pair(plan, key, value):
                raise RuntimeError(f"Did not find expected key-value pair ({key}, {value}) in plan")

    def get_plan(self, agent_instance_id: int, turn_id: int):
        route = "api/sico/conversation/plan"
        url = f"http://{self.endpoint}/{route}"
        payload = {
            "agentInstanceId": agent_instance_id,
            "turnId": turn_id
        }
        try:
            token = self.get_token(self.username)
            headers = {
                "Authorization": f"Bearer {token}"
            }
            response = requests.get(url, params=payload, headers=headers)
            response.raise_for_status()
            return response.json()
        except requests.RequestException as e:
            print(f"Error fetching plan: {e}")
            return None

if __name__ == "__main__":

    parser = argparse.ArgumentParser(description="Sico health check script")
    parser.add_argument("--platform", choices=["docker-compose", "kind"], default="docker-compose")
    parser.add_argument("--skip-setup", action="store_true", help="Skip the setup steps")
    args = parser.parse_args()

    h = Health()

    if not args.skip_setup:
        h.ensure_emulator_running()

        # remove any existing clusters or docker-compose services
        h.kind_down()
        h.compose_down()

        # start service
        if args.platform == "kind":
            h.kind_up()
        elif args.platform == "docker-compose":
            h.compose_up()
        else:
            raise ValueError(f"Unknown platform specified: {args.platform}")

    h.chat_greetings()
    h.chat_run_upload()
    h.chat_run_android_edge_test()
