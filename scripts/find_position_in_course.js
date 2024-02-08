const delay = 100;

setTimeout(function() {

	var button = document.createElement('button');
	button.innerHTML = 'Find Position in Course';
	button.classList.add("myButton", "myButton--apple", "page-btns__btn");

	// Add styles to the button
	/*
	Example of style can be as follow:
	<code>
	button.style.backgroundColor = '#4CAF50';
	button.style.color = 'white';
	button.style.border = 'none';
	</code>
	*/
	button.style.padding = '40px';
	button.style.borderRadius = '5px';
	button.style.cursor = 'pointer';

	// Set button click functionality
	button.addEventListener('click', function() {
	  	urlString = window.location.href;
	  	// Extract the number after "explore"
		const exploreNumber = urlString.match(/explore\/(\d+)/);
	  	// Check if a match is found
	  	var number = null;
	  	var inputValue = null;

		if (exploreNumber && exploreNumber[1]) {
		  // The extracted number
		  number = exploreNumber[1];
		}

		const iframe = document.querySelector('iframe');
		var iframeDocument = iframe.contentDocument || iframe.contentWindow.document;
		var inputElement = iframeDocument.getElementById('inputFEN');

	    // Check if the input element is found
	    if (inputElement) {
	    	// Get the value of the input
	    	inputValue = inputElement.value;
	    }

	    if (number && inputValue) {
	    	newTabUrl = 'https://www.chessable.com/course/' + number + '/fen/' + inputValue.replaceAll('/', ';');
	    	window.open(newTabUrl, '_blank');
	    }
	});

	// Create a container div for the button
	var buttonContainer = document.createElement('div');
	buttonContainer.id = 'findInCourse';
	buttonContainer.className = 'button-container';
	buttonContainer.appendChild(button);
	buttonContainer.style.position = 'fixed'
	buttonContainer.style.bottom = '20px';
  	buttonContainer.style.right = '20px';
  	buttonContainer.style.zIndex = 999;

	// Append the container to the body
	document.body.appendChild(buttonContainer);
}, delay);
