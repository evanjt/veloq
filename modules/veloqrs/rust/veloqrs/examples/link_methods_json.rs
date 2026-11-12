//! Prints the text of `web/connect/methods.json`, rendered from the link
//! method table.
//!
//! Usage:
//!   cargo run -q -p veloqrs --example link_methods_json > web/connect/methods.json

fn main() {
    print!("{}", veloqrs::remote::protocol::methods_json());
}
