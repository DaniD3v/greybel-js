const User = require('../entities/user');
const Folder = require('../entities/folder');
const File = require('../entities/file');
const FileSystem = require('../file-system');
const fileClient = require('../api/file');
const resolve = FileSystem.prototype.resolve;

const parseBlob = function(blob) {
	return JSON.parse(blob.toString());
};

const sequence = function(items, callback) {
	return items.reduce(function(list, item) {
		return callback(item).then(function(x) {
			list.push(x);
			return list;
		});
	}, []);
};

const parseFileSystem = function(fileSystemBlob) {
	const stack = [];
	const map = {};
	const fileSystemData = parseBlob(fileSystemBlob);
	const next = async function(item) {
		const isFolder = item.hasOwnProperty('files') && item.hasOwnProperty('folders');

		if (isFolder) {
			const folder = new Folder(item);
			const name = folder.getName();
			let path = resolve(stack.concat([name]).join('/')) || '/';

			folder.setPath(path);
			stack.push(name);

			const folders = sequence(item.folders, next);
			const files = sequence(item.files, next);

			folder.setFolders(folders);
			folder.setFiles(files);

			map[path] = folder;

			stack.pop();

			return folder;
		}

		const entity = new File(item);
		const path = resolve(stack.concat([entity.getName()]).join('/'));

		entity.load();

		entity.setPath(path);
		map[path] = entity;

		return entity;
	};
	const rootFolder = next(fileSystemData);

	return {
		map: map,
		rootFolder: rootFolder
	};
};

module.exports = async function(data) {
	return {
		users: Object.values(parseBlob(data.users)).map((item) => new User(item)),
		fileSystem: new FileSystem(parseFileSystem(data.fileSystem)),
		configOS: data.configOS,
		Hardware: data.Hardware
	};
};