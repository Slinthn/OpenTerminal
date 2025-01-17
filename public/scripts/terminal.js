var recv_buffer = [];
var send_buffer = [];

var content;
var server_indicator;
var mobile_input;

var client;

var my_colour = false;
var pre_buffer_chars = 0;
var server_url = "";
var enable_input = true;

const DATA_TYPES = {
	ping: 0,
	text: 1,
	colour: 2,
	buffer: 3,
	backspace: 4,
	backword: 5,
	arrow: 6,
};

/**
 * starting OpenTerminal!
 * "we have `int main()` at home"
 */
export function start() {
	console.log("%chello, world!", "color: #b7fd49; font-size: 3rem; font-weight: bold");
	console.log(
`welcome to OpenTerminal!
home to an online terminal and communal text buffer.

i hope you enjoy your stay here!
to help you feel a little more comfortable, i've prepared some commands for you:

- set_colours(foreground, background)
	changes the foreground and background colours of your terminal!
	\`foreground\` and \`background\` must be hex colour codes, such as \`#ff00ff\`.

- set_palette(palette_name)
	changes the foreground and background colours of your terminal to one of our many options of premade themes! including but not limited to the entire collection of catppuccin mocha colours! (i really like their palette ;p)

	try it out! enter \`PALETTE\` into your console and browse the list of themes we have!

- toggle_lcd()
	swaps out the flickering CRT scanline effect for a more modern, LCD screen effect! (bonus: may reduce eye strain)`);

	server_url = new URL(window.location).searchParams.get("server") || window.location.host;

	const foreground = localStorage.getItem("foreground");
	const background = localStorage.getItem("background");
	if (foreground && background) {
		window.set_colours(foreground, background);
	}

	if (localStorage.getItem("lcd")) {
		document.body.classList.add("lcd");
	}

	content = document.getElementById("content");
	server_indicator = document.getElementById("server-url");
	mobile_input = document.getElementById("mobile-input");

	document.addEventListener("keydown", handle_input);
	document.addEventListener("paste", handle_paste);
	
	content.addEventListener("touchend", () => {
		mobile_input.focus();
	});

	setInterval(() => {
		if (!client || !client.readyState == 1) return;
		if (send_buffer.length > 0) {
			const data = JSON.stringify(send_buffer[0]);
			client.send(data);
			send_buffer = send_buffer.slice(1);
		}
	}, 1000 / 600);

	setInterval(() => {
		mobile_input.value = content.innerText;
	}, 1000 / 60);

	connect(new URL(window.location).searchParams.get("server") || window.location.host);
}

/**
 * closes any existing websocket connection and attempts to create a new one. 
 * `wss://` is prefixed automatically if not present.
 * insecure websockets are not recommended and support is not planned.
 * @param {string} server_url - the server websocket url to connect to.
 */
export async function connect(server_url) {
	if (client && client.readyState == 1) { // OPEN
		client.close();

		await new Promise((resolve) => {
			setInterval(() => {
				if (client.readyState == 3) {
					resolve();
				}
			}, 100);
		});
	}

	pre_buffer_chars = 0;
	content.innerHTML = "";
	server_indicator.innerText = "connecting...";

	add_system_message("Connecting to the server...\n");

	let protocol = false;

	// check if user explicitly stated secure/insecure protocol
	if (server_url.startsWith("wss://")) {
		protocol = "wss://";
		server_url = server_url.split(6);
	} else if (server_url.startsWith("ws://")) {
		server_url = server_url.split(5);
		protocol = "ws://";
	}
	// otherwise, probe the url!
	else protocol = await get_available_socket_protocol(server_url);

	// no server was found!
	if (!protocol) {
		return add_system_message(`\n[NO SERVER FOUND AT ${server_url}!]\n`);
	}

	// server was found, but it's insecure!
	if (protocol === "ws://") {
		const warn_dialog = document.getElementById("warn-dialog");
		const warn_close = warn_dialog.getElementsByClassName("dialog-close").item(0);
		const user_wants_insecure = await new Promise((Resolve, Reject) => {
			const dialog_backdrop = document.getElementById("dialog-backdrop");
			const warn_proceed = document.getElementById("warn-proceed");
			const warn_cancel = document.getElementById("warn-cancel");

			warn_dialog.classList.add("show");
			dialog_backdrop.classList.add("show");

			set_enable_input(false);

			warn_close.addEventListener('click', () => {
				Resolve(false);
			});
			warn_cancel.addEventListener('click', () => {
				Resolve(false);
			});
			warn_proceed.addEventListener('click', () => {
				Resolve(true);
			});
		});

		warn_close.click();

		set_enable_input(true);

		if (!user_wants_insecure) {
			server_indicator.innerText = "not connected";
			add_system_message(`\n[CONNECTION CLOSED]\n`);
			return;
		}
	}

	client = new WebSocket(protocol + server_url);

	client.addEventListener('open', () => {
		server_indicator.innerText = server_url;
		add_system_message(`Connection successful.\n\n`);
		add_system_message(`=== BEGIN SESSION ===\n\n`);
		new_caret();
	});

	client.addEventListener('message', handle_message);

	client.addEventListener('close', () => {
		server_indicator.innerText = "not connected";
		add_system_message(`\n[CONNECTION CLOSED]\n`);
	});

	client.addEventListener('error', () => {
		add_system_message(`\nConnection failed!\n`);
		add_system_message("Ensure you entered the correct server URL, or check the console for more details.\n");
	});
}

/**
 * probes the `server_url` for a secure websocket connection first, an insecure websocket second, or resolves to `false` on failure.
 * @param {string} server_url 
 * @returns a promise either resolving to the discovered protocol, or false on failure.
 */
function get_available_socket_protocol(server_url) {
	return new Promise((Resolve, Reject) => {
		const secure_client = new WebSocket("wss://" + server_url);

		secure_client.addEventListener('open', () => {
			Resolve("wss://");
		});

		secure_client.addEventListener('error', () => {
			const insecure_client = new WebSocket("ws://" + server_url);

			insecure_client.addEventListener('open', () => {
				Resolve("ws://");
			});

			insecure_client.addEventListener('error', () => {
				Reject(false);
			});

		});
	});
}

/**
 * appends a client-side message to the text buffer.
 * @param {string} text - text to send to the buffer.
 */
function add_system_message(text) {
	const span = document.createElement("span");
	span.classList.add('sticky');
	span.innerText = text;
	content.appendChild(span);

	new_caret();
}

/**
 * the message handler for the websocket.
 */
function handle_message(event) {
	var data;
	try {
		data = JSON.parse(event.data);
	} catch (error) {
		return false;
	}

	if (!data.type && data.type != 0) return;

	const is_at_bottom = content.scrollHeight - content.offsetHeight - content.scrollTop < 10;
	
	switch (data.type) {
		case DATA_TYPES.ping:
			client.send(JSON.stringify({type: DATA_TYPES.ping}));
			break;
		case DATA_TYPES.colour:
			my_colour = data.colour;
			console.log(`%cColour has been changed to ${my_colour}`, `color: ${my_colour}`);
			break;
		case DATA_TYPES.backspace:
			content.querySelectorAll("#caret").forEach(caret => caret.remove());
			/*
			const last_child = content.lastChild;
			if (last_child.classList.contains('sticky')) break;
			last_child.remove();
			*/		
			if (content.innerText.length <= pre_buffer_chars) {
				break;
			}
			content.innerText = content.innerText.slice(0, content.innerText.length - 1);
			break;
		case DATA_TYPES.text:
			/*
			const span = document.createElement("span");
			if (data.colour) span.style.color = data.colour;
			if (data.sticky) span.classList.add('sticky');
			span.innerText = data.text;
			content.appendChild(span);
			*/
			content.innerText += data.text;
			break;
		case DATA_TYPES.buffer:
			content.innerText += data.data;
			break;
			/*
			data.data.forEach(block => {
				handle_message(block);
			});
			*/
	}

	if (pre_buffer_chars == 0) {
		pre_buffer_chars = content.innerText.length;
	}
	
	new_caret();

	if (is_at_bottom) content.scrollTop = content.scrollHeight - content.offsetHeight;
}

/**
 * clears any existing caret from the terminal, and replaces it at the end of the buffer.
 */
function new_caret() {
	content.querySelectorAll("#caret").forEach(caret => caret.remove());
	const new_caret = document.createElement("div");
	new_caret.id = "caret";
	if (my_colour) {
		new_caret.style.backgroundColor = my_colour;
	}
	content.appendChild(new_caret);
}

/**
 * sets whether or not the terminal should accept user input
 * (handy for not interfering with dialogs)
 * @param {value} boolean 
 */
export function set_enable_input(value) {
	enable_input = value;
}

/**
 * the input handler for the document.
 * automatically scrolls to the bottom of the page on valid key presses.
 */
function handle_input(event) {
	if (!enable_input) return;

	if (event.key == "'") {
		event.preventDefault();
	}

	switch (event.key) {
		case "Backspace":
			if (event.ctrlKey) {
				if (send_buffer.length > 0) return;
				/*
				send_buffer.push({
					type: DATA_TYPES.backword,
				});
				*/
				var break_point = content.innerText.lastIndexOf(" ");
				const last_newline = content.innerText.lastIndexOf("\n");
				if (last_newline > break_point) break_point = last_newline;
				const count = content.innerText.length - break_point;
				for (var i = 0; i < count; i++) {
					send_buffer.push({
						type: DATA_TYPES.backspace,
					});
				}
				return;
			}
			send_buffer.push({
				type: DATA_TYPES.backspace,
			});
			return;
		case "Enter":
			send_buffer.push({
				type: DATA_TYPES.text,
				text: "\n",
			});
			return;
		case "ArrowUp":
			send_buffer.push({
				type: DATA_TYPES.arrow,
				dir: "up",
			});
			return;
		case "ArrowDown":
			send_buffer.push({
				type: DATA_TYPES.arrow,
				dir: "down",
			});
			return;
		case "ArrowLeft":
			send_buffer.push({
				type: DATA_TYPES.arrow,
				dir: "left",
			});
			return;
		case "ArrowRight":
			send_buffer.push({
				type: DATA_TYPES.arrow,
				dir: "right",
			});
			return;
	}

	if (event.key.length > 1) {
		// server will discard text over 1 character, anyway
		return;
	}

	if (event.ctrlKey || event.metaKey) {
		return;
	}

	send_buffer.push({
		type: DATA_TYPES.text,
		text: event.key,
	});

	content.scrollTop = content.scrollHeight - content.offsetHeight;
}

/**
 * paste event handler for the document.
 * if there is nothing currently in-flight to the server, the contents
 * of the clipboard are sent in one go to the server, and the user is
 * automatically scrolled to the bottom of the page.
 */
function handle_paste(event) {
	event.preventDefault();

	if (send_buffer.length > 0) {
		return;
	}

	const paste = (event.clipboardData || window.clipboardData).getData("text");
	send_buffer.push({
		type: DATA_TYPES.text,
		text: paste,
	});
	content.scrollTop = content.scrollHeight - content.offsetHeight;
}
