//! Prints the text of `examples/link/vectors.json`: fixed inputs and the
//! bytes the link derives from them.
//!
//! Usage:
//!   cargo run -q -p veloqrs --example link_vectors_json > veloqrs/examples/link/vectors.json

fn main() {
    print!("{}", veloqrs::remote::vectors::vectors_json());
}
