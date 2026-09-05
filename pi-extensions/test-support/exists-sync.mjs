// In this disposable probe, inaccessible paths appear absent to existence checks.
// Real reads/writes remain subject to Node permissions; other errors must surface.
export function hideDeniedExistenceChecks(existsSync) {
	return (path) => {
		try {
			return existsSync(path);
		} catch (error) {
			if (error?.code === "ERR_ACCESS_DENIED") return false;
			throw error;
		}
	};
}
