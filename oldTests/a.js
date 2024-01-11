class A {
    constructor() {
        console.error('before')
        (async() => {
            console.error('a1')
            await this.delay(1000)
            console.error('a2')
        })();
        console.error('after')
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

new A()